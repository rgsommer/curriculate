// backend/services/stocksRecValidator.js
//
// Post-generation validator for AI-emitted recommendations. This is the
// "hard gate" layer that converts sleeve / concentration / expectancy /
// price-integrity rules from AI-facing advice (which the AI often
// ignores) into pipeline gates that REJECT violating recs before they
// reach the user.
//
// Called between parseRecsFromBriefing and StocksAdviceRec.insertMany in
// every rec-persist site (briefing cron, send-briefing on-demand,
// finalizeAdvice on the Advice tab). Rejected recs never land in the
// scorecard collection and never appear as actionable cards.
//
// Each rule is an independent function that takes {rec, context} and
// returns {ok: bool, reason?, detail?}. Adding a new gate is one entry
// in the RULES array — the framework runs all of them and aggregates.
//
// Rules currently enforced (highest-leverage first, per Grok's plan):
//   sleeve-spec-cap-hard              — BUY on SPEC when SPEC is at/over cap
//   sleeve-core-widen                 — new non-CORE BUY when CORE is >10pp under
//   single-name-cap                   — BUY that would push one ticker past 15% of book
//   sell-no-redeploy-core-underweight — SELL/TRIM with no companion CORE BUY
//                                       when CORE is >10pp under (batch rule)
//   sell-redeploy-account-mismatch    — SELL paired with CORE BUY in a
//                                       different account (dormant until parser
//                                       preserves account on <RECS>)
//   buy-not-core-while-core-underweight — belt-and-suspenders batch backstop
//                                       to the per-rec sleeve-core-widen rule
//   cross-account-fragmentation       — BUY on a ticker already held in
//                                       a different account (avoid paying
//                                       commission per-account on future exits)
//   sector-laggard-hard-avoid         — BUY whose sector is bottom-3 by
//                                       60d RS vs SPY when regime is
//                                       hostile (CORE ETFs exempt)
//   regime-hostile-no-new-swing-spec  — any BUY that isn't a CORE ETF
//                                       when regime is hostile (broader
//                                       than sector-laggard — even
//                                       leader-sector SWING/SPEC blocked)
//   price-drift-stale                 — rec.entryPrice is >5% away from
//                                       the current Yahoo+FMP consensus;
//                                       stale price → wrong sizing/stops
//   expectancy-floor-negative         — non-CORE BUY when user's overall
//                                       AI-rec expectancy (n≥20) is ≤ -1%
//                                       (process bleeding; slow down)
//   liquidity-floor                   — non-CORE BUY on a name whose
//                                       avg daily $ volume is below the
//                                       sleeve-aware floor (SWING $10M,
//                                       SPEC $3M CAD-equivalent)
//
// (all planned rules landed — this list can be trimmed once dust settles)
//
// Design principles:
//   • Validators are pure functions — no I/O, no DB writes. Callers
//     compose them with whatever context they already have.
//   • Reject-and-log by default. Never mutate the rec. Never partially
//     accept ("size at 0.3× because expectancy is low") — that's the
//     AI's job to reason about, and half-decisions from a validator
//     are worse than a clean reject with a stated reason.
//   • Every rejection carries a machine-readable `reason` slug + a
//     human-readable `detail` so the user can see EXACTLY what got
//     blocked and why (future UI: "rejected recs" section under Advice).

import { classifyPosition } from "./stocksSleeveEnforcer.js";
import { getSectorLaggards, mapTickerToSector } from "./stocksSectorRotation.js";

// Base-ticker normalization — same rule the sleeve enforcer uses so a
// CAD-listed holding and its US ADR aren't treated as separate exposures.
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// ─────────────────────────────────────────────────────────────────────
// Individual gate functions. Each: (rec, ctx) → { ok, reason?, detail? }
// ─────────────────────────────────────────────────────────────────────

// SPEC over cap is a hard block on any new SPEC BUY. The briefing prompt
// already tells the AI this, but the AI still emits SPEC recs
// occasionally (e.g. the July 31 briefing surfaced ZETA with
// "spec-sleeve already 4.7pp over limit"). The validator refuses
// regardless of AI reasoning.
function ruleSpecCapHard({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const sleeve = classifyPosition({ ticker: rec.ticker });
  if (sleeve !== "spec") return { ok: true };
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct) return { ok: true }; // no context — don't block
  const specPct = bal.actualPct.spec;
  const specTargetPct = bal.targetsPct?.spec ?? 5;
  if (specPct <= specTargetPct) return { ok: true };
  return {
    ok: false,
    reason: "sleeve-spec-cap-hard",
    detail: `SPEC sleeve at ${specPct.toFixed(1)}% is already over the ${specTargetPct}% cap. New SPEC BUYs are hard-blocked until the sleeve shrinks back under target. AI proposed BUY ${rec.ticker} anyway — rejected.`,
  };
}

// A new BUY that isn't CORE while CORE is >10pp under target is exactly
// the wrong direction. Force capital toward CORE until the gap closes
// by at least half. Deliberately loose (10pp not 5pp) so normal drift
// doesn't block every rec, only genuinely lopsided books.
function ruleCoreGapWidening({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct || !bal.targetsPct) return { ok: true };
  const coreGap = bal.targetsPct.core - bal.actualPct.core;
  if (coreGap <= 10) return { ok: true }; // CORE close enough to target
  const sleeve = classifyPosition({ ticker: rec.ticker });
  if (sleeve === "core") return { ok: true }; // BUY IS a CORE ticker — allowed
  return {
    ok: false,
    reason: "sleeve-core-gap-widening",
    detail: `CORE sleeve is ${coreGap.toFixed(1)}pp underweight (${bal.actualPct.core.toFixed(1)}% vs ${bal.targetsPct.core.toFixed(0)}% target). New BUYs on non-CORE tickers widen the imbalance instead of closing it. AI proposed BUY ${rec.ticker} (${sleeve.toUpperCase()}) — rejected. Rotate proceeds into XIU/VUN/XEQT/XBAL first, or wait for CORE gap to close to ≤10pp.`,
  };
}

// A BUY that would push any single base ticker past 15% of book is a
// concentration risk the trader's own risk profile flags but the AI
// doesn't respect. Hard cap.
function ruleSingleNameCap({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const bookCad = ctx.bookCad;
  if (!(bookCad > 0)) return { ok: true };
  const fx = ctx.fxUsdCad || 1.37;
  const positions = ctx.positions || [];
  const base = baseTicker(rec.ticker);
  const existingCad = positions
    .filter(p => baseTicker(p.ticker) === base && (p.qty || 0) > 0)
    .reduce((s, p) => {
      const cad = (Number.isFinite(p.priceCad) ? p.priceCad
        : Number.isFinite(p.priceUsd) ? p.priceUsd * fx : 0) * (p.qty || 0);
      return s + cad;
    }, 0);
  const buyShares = rec.shares || 0;
  const buyPrice = rec.entryPrice || 0;
  if (!(buyShares > 0) || !(buyPrice > 0)) return { ok: true }; // unsized rec — skip
  const buyCad = rec.entryCurrency === "USD" ? buyShares * buyPrice * fx : buyShares * buyPrice;
  const postBuyCad = existingCad + buyCad;
  const postBuyPct = (postBuyCad / bookCad) * 100;
  const CAP_PCT = 15;
  if (postBuyPct <= CAP_PCT) return { ok: true };
  return {
    ok: false,
    reason: "single-name-cap",
    detail: `BUY ${rec.shares} sh ${rec.ticker} @ $${rec.entryPrice} would push the ${base} position to ${postBuyPct.toFixed(1)}% of book (existing ${((existingCad / bookCad) * 100).toFixed(1)}% + ${((buyCad / bookCad) * 100).toFixed(1)}% new), above the ${CAP_PCT}% single-name cap. Downsize the buy or trim the existing lot first.`,
  };
}

// Liquidity floor gate: block BUYs on tickers whose average daily
// dollar volume is below the floor. Thin liquidity = wide spreads +
// slippage + inability to exit at a sensible price if the thesis
// breaks. CORE ETFs are always liquid — exempt. Unknown/missing
// volume → no-op (missing data ≠ block). SPEC gets a lower floor
// than SWING since micro-cap exposure IS the point of the sleeve;
// the goal is to keep untradeable names out, not enforce large-cap-only.
const LIQUIDITY_FLOOR_CAD = {
  swing: 10_000_000, // $10M/day — enough for the trader's typical position size to be a rounding error
  spec:   3_000_000, // $3M/day — permissive; smaller SPEC positions can survive here
};
function ruleLiquidityFloor({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  if (isCoreBuy(rec)) return { ok: true };
  const liq = ctx.liquidity?.[String(rec.ticker).toUpperCase()];
  if (!liq || !(liq.dailyDollarVol > 0)) return { ok: true }; // no data — skip
  const fx = ctx.fxUsdCad || 1.37;
  // Convert to CAD for uniform comparison. Liquidity is fetched from
  // FMP in the security's listing currency, so USD tickers need FX.
  const dvCad = liq.currency === "CAD" ? liq.dailyDollarVol : liq.dailyDollarVol * fx;
  // Sleeve-aware floor via same classifier the enforcer uses. Default
  // to SPEC floor for unclassified tickers (the stricter direction is
  // "harder to trade"; SPEC floor is looser, so classify unknown as
  // SPEC to avoid over-blocking).
  const sleeve = classifyPosition({ ticker: rec.ticker });
  const floor = LIQUIDITY_FLOOR_CAD[sleeve] ?? LIQUIDITY_FLOOR_CAD.spec;
  if (dvCad >= floor) return { ok: true };
  const dvStr = dvCad >= 1e6 ? `$${(dvCad / 1e6).toFixed(1)}M` : `$${(dvCad / 1e3).toFixed(0)}k`;
  const floorStr = `$${(floor / 1e6).toFixed(0)}M`;
  return {
    ok: false,
    reason: "liquidity-floor",
    detail: `BUY ${rec.ticker} rejected — avg daily dollar volume ${dvStr} CAD is below the ${sleeve.toUpperCase()} sleeve floor of ${floorStr} CAD. Thin liquidity means wide spreads and exit slippage — pick a more liquid name in the same sector.`,
  };
}

// Expectancy floor gate: if the user's recent AI-emitted rec history
// has closed enough trades to be statistically meaningful (n ≥ 20)
// AND overall expectancy is deeply negative (≤ -1% avg return per
// trade), block new BUYs on non-CORE tickers. Point isn't to freeze
// the whole book — CORE ETF rebalances still fire — but to force a
// pause on discretionary swing/spec entries while the AI's process
// is bleeding, so the user doesn't compound losses on autopilot.
// Missing ctx.userExpectancy → no-op. Underpowered sample (<20) →
// no-op (expectancy math too noisy to gate on).
const EXPECTANCY_FLOOR_PCT = -1.0;
function ruleExpectancyFloor({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  if (isCoreBuy(rec)) return { ok: true }; // CORE always allowed
  const exp = ctx.userExpectancy;
  if (!exp || !exp.proven) return { ok: true };
  if (exp.expectancyPct == null || exp.expectancyPct > EXPECTANCY_FLOOR_PCT) return { ok: true };
  return {
    ok: false,
    reason: "expectancy-floor-negative",
    detail: `BUY ${rec.ticker} rejected — recent AI-rec expectancy is ${exp.expectancyPct.toFixed(2)}% over ${exp.trades} closed trades (win rate ${exp.winRate.toFixed(1)}%). Below the ${EXPECTANCY_FLOOR_PCT}% floor. Discretionary BUYs paused until expectancy recovers; CORE rebalances still allowed. Consider what's dragging performance (source scorecard) before overriding.`,
  };
}

// Live-price drift gate: if the rec's entryPrice is materially out of
// sync with the current dual-source (Yahoo+FMP) price, the rec was
// authored on stale data — sizing, stops, and target math all suffer.
// Reject rather than persist a rec that will trigger at a wrong level
// or lock in the wrong risk. The rule needs `ctx.livePrices[TICKER]`
// pre-populated (the async fetch happens outside the validator, in
// generateBriefing, so validator rules stay synchronous). Missing
// livePrices entry → rule no-ops (don't block on missing data).
const PRICE_DRIFT_THRESHOLD = 0.05; // 5% — tighter than the 10% cross-check disagreement threshold
function ruleLivePriceDrift({ rec, ctx }) {
  if (!rec.entryPrice || !rec.ticker) return { ok: true };
  const live = ctx.livePrices?.[String(rec.ticker).toUpperCase()];
  if (!live || !(live.price > 0)) return { ok: true }; // no live data — don't block
  const drift = Math.abs(live.price - rec.entryPrice) / Math.max(live.price, rec.entryPrice);
  if (drift <= PRICE_DRIFT_THRESHOLD) return { ok: true };
  const direction = rec.entryPrice > live.price ? "above" : "below";
  return {
    ok: false,
    reason: "price-drift-stale",
    detail: `${rec.action} ${rec.ticker} @ $${rec.entryPrice} ${rec.entryCurrency || ""} is ${(drift * 100).toFixed(1)}% ${direction} the current cross-checked price of $${live.price.toFixed(2)} (source: ${(live.sources || []).join("+") || "unknown"}, confidence: ${live.confidence || "unknown"}). Stale entry price means wrong sizing + wrong stop % + wrong trigger — refresh the price and re-emit.`,
  };
}

// Regime hard gate: when the regime module flags an unfavourable tape
// (risk-off / hostile / bear / contraction / distribution), block any
// new BUY that isn't a CORE ETF. CORE keeps flowing so the sleeve
// stays healthy even in bear regimes; discretionary SWING/SPEC entries
// are what regime hostility is meant to suppress. Composes cleanly
// with ruleSectorLaggardBuy (which handles a narrower "hostile AND
// laggard sector" case for CORE-adjacent tickers).
function ruleRegimeHostileNoNewSwingSpec({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const regimeLabel = String(ctx.tradingRegime?.label || ctx.tradingRegime?.regime || "").toLowerCase();
  const regimeHostile = /risk[- ]?off|hostile|bear|contract|distribut/i.test(regimeLabel);
  if (!regimeHostile) return { ok: true };
  if (isCoreBuy(rec)) return { ok: true };
  const label = ctx.tradingRegime?.label || ctx.tradingRegime?.regime;
  return {
    ok: false,
    reason: "regime-hostile-no-new-swing-spec",
    detail: `BUY ${rec.ticker} is not a CORE ETF, but the regime detector flags **${label}**. Only CORE ETF adds (XEQT / VUN / XIU / VOO / VTI / …) are allowed until regime turns constructive. Wait for the regime to flip or route the capital to CORE instead.`,
  };
}

const RULES = [
  ruleSpecCapHard,
  ruleCoreGapWidening,
  ruleSingleNameCap,
  ruleRegimeHostileNoNewSwingSpec,
  ruleLivePriceDrift,
  ruleLiquidityFloor,
  ruleExpectancyFloor,
];

// ─────────────────────────────────────────────────────────────────────
// Batch-level rules. Run over the FULL list of already-per-rec-accepted
// recs and can reject individual recs based on sibling context (e.g. a
// SELL without any companion BUY in the same batch when CORE is
// underweight — the freed cash would compound the sleeve gap).
//
// Each batch rule: (recs, ctx) → [ { recIndex, reason, detail }, ... ]
// where recIndex is the position of the offending rec in the input
// array. validateRecs applies these rejections after per-rec rules.
// ─────────────────────────────────────────────────────────────────────

// CORE ETF bases (kept in sync with CORE_ETFS in stocksSleeveEnforcer).
// Duplicated locally so the validator has no import cycle with the
// enforcer and can be evolved independently. Any change here should
// mirror there — otherwise a rec that classifies as CORE for sleeve
// counting won't count as CORE for pairing satisfaction.
const CORE_BUY_BASES = new Set([
  "SPY", "VOO", "IVV", "VTI", "ITOT", "SPTM",
  "QQQ", "VUG", "SCHG",
  "IWM", "VB",
  "XIU", "XIC", "VCN", "XEQT", "XGRO", "XBAL", "VBAL", "VGRO", "VEQT",
  "VFV", "XUS", "VUN", "XUU",
  "AGG", "BND", "XBB", "VAB", "ZAG", "TLT", "IEF",
]);

function isCoreBuy(rec) {
  if (!rec || rec.action !== "BUY") return false;
  return CORE_BUY_BASES.has(baseTicker(rec.ticker));
}

// Best-effort account equality. Returns true when either side omits an
// account (parser doesn't preserve account today, so this is inert
// for the AI-emitted rec path — but if a future parser change adds
// account propagation, the check becomes active without a rewrite).
function sameAccount(a, b) {
  if (!a || !b) return true;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// A discretionary SELL/TRIM that arrives at the validator was authored
// by the AI (mandatory hard-stop SELLs are pre-rendered in the briefing
// prefix and never round-trip through <RECS>). When CORE is >10pp
// under target, EVERY SELL/TRIM in the batch must be paired with a
// companion CORE BUY (not just any BUY) — a SWING/SPEC BUY doesn't
// close the sleeve gap, so pairing against it would still leave CORE
// bleeding. This is deliberately stronger than the initial "any BUY"
// version (per Grok's audit): naked SELLs, SELLs paired only with
// SWING/SPEC BUYs, and BUYs that aren't CORE while the gap is open all
// get rejected here at batch level.
function ruleBatchPairedRedeploy(recs, ctx) {
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct || !bal.targetsPct) return [];
  const coreGap = bal.targetsPct.core - bal.actualPct.core;
  // Rule only fires when CORE is meaningfully underweight. If CORE is
  // already close to target, naked SELLs are fine — cash accumulation
  // doesn't compound a gap that doesn't exist.
  if (coreGap <= 10) return [];

  const list = recs || [];
  const sells = list
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.action === "SELL" || r.action === "TRIM");
  if (sells.length === 0 && list.filter(r => r.action === "BUY").length === 0) return [];

  // Pool of CORE BUYs available as redeploy destinations. Each CORE
  // BUY can only cover ONE SELL (proceeds don't multiply); pairing
  // preference is same-account-first, then any-account fallback.
  const coreBuys = list
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isCoreBuy(r));
  const usedCoreBuyIdx = new Set();

  const rejections = [];

  // For each SELL: find a CORE BUY match, prefer same-account.
  for (const { r: sell, i: sellIdx } of sells) {
    let match = coreBuys.find(({ r, i }) => !usedCoreBuyIdx.has(i) && sameAccount(sell.account, r.account));
    if (!match) match = coreBuys.find(({ i }) => !usedCoreBuyIdx.has(i));
    if (!match && coreBuys.length > 0) match = coreBuys[0]; // shared redeploy still better than none

    if (!match) {
      rejections.push({
        recIndex: sellIdx,
        reason: "sell-no-redeploy-core-underweight",
        detail:
          `${sell.action} ${sell.ticker} has no companion CORE BUY in the same batch, ` +
          `but CORE is ${coreGap.toFixed(1)}pp underweight. Pair this ${sell.action} with a ` +
          `CORE BUY (XEQT / VUN / XIU / VOO / VTI / …) in the same account and currency, ` +
          `or drop the ${sell.action} until a redeploy target is defined. Naked ${sell.action} rejected.`,
      });
      continue;
    }

    usedCoreBuyIdx.add(match.i);

    // Same-account mismatch reject (dormant until parser preserves
    // account — see sameAccount comment). Keeps the "proceeds don't
    // cross accounts" invariant enforceable end-to-end once account
    // is threaded through the pipeline.
    if (sell.account && match.r.account && !sameAccount(sell.account, match.r.account)) {
      rejections.push({
        recIndex: sellIdx,
        reason: "sell-redeploy-account-mismatch",
        detail:
          `${sell.action} ${sell.ticker} in ${sell.account} is paired with CORE BUY ` +
          `${match.r.ticker} in ${match.r.account}. Redeploy must stay in the same account ` +
          `(proceeds do not automatically cross accounts). Rejected.`,
      });
    }
  }

  // Belt-and-suspenders: reject any non-CORE BUY at batch level while
  // the gap is open. In the current pipeline this is largely redundant
  // with ruleCoreGapWidening (per-rec, same >10pp threshold) so it
  // typically only fires if the per-rec rule is disabled or its
  // threshold drifts. Keeps the batch-level intent readable and the
  // guarantee explicit.
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.action !== "BUY") continue;
    if (isCoreBuy(r)) continue;
    rejections.push({
      recIndex: i,
      reason: "buy-not-core-while-core-underweight",
      detail:
        `BUY ${r.ticker} is not a CORE ETF, but CORE is ${coreGap.toFixed(1)}pp underweight. ` +
        `Only CORE ETFs (XEQT / VUN / XIU / VOO / VTI / …) are allowed as new buys until CORE ≥ target−10pp. Rejected.`,
    });
  }

  return rejections;
}

// A BUY on a ticker the trader ALREADY holds in a DIFFERENT account
// fragments the position across accounts. Every future SELL/rebalance
// then costs an extra commission per account holding the name — so a
// user with RY in RRSP + Non-Spousal pays 2× $9.95 to fully exit RY.
// This rule blocks the fragmentation-widening BUY. Consolidating in
// the already-held account (or picking a different ticker) is the
// intended response.
function ruleAccountFragmentation(recs, ctx) {
  const positions = ctx.positions || [];
  if (positions.length === 0) return [];

  // Existing holdings grouped by base ticker → accounts holding it.
  const held = new Map(); // base → Set<account>
  for (const p of positions) {
    if (!(p.qty > 0)) continue;
    const base = baseTicker(p.ticker);
    const acct = String(p.account || "").trim();
    if (!base || !acct) continue;
    if (!held.has(base)) held.set(base, new Set());
    held.get(base).add(acct);
  }
  if (held.size === 0) return [];

  const rejections = [];
  for (let i = 0; i < (recs || []).length; i++) {
    const r = recs[i];
    if (r.action !== "BUY") continue;
    const base = baseTicker(r.ticker);
    const heldAccts = held.get(base);
    if (!heldAccts || heldAccts.size === 0) continue;
    // Parser doesn't preserve rec.account today, so we can't verify
    // "BUY is in the already-held account" — the safest current
    // response is: if the ticker is held ANYWHERE, warn/reject unless
    // the rec explicitly names the same account. Once account
    // propagation lands, tighten to "reject only when rec.account is
    // absent from heldAccts".
    if (r.account && heldAccts.has(String(r.account).trim())) continue;
    const acctList = [...heldAccts].join(", ");
    rejections.push({
      recIndex: i,
      reason: "cross-account-fragmentation",
      detail:
        `BUY ${r.ticker} would fragment the position across accounts — ${r.ticker} is already ` +
        `held in ${acctList}. Every future SELL/rebalance then pays commission per account ` +
        `holding the name. Add to the existing ${r.ticker} position in ${acctList} instead, ` +
        `or pick a different ticker. Rejected.`,
    });
  }
  return rejections;
}

// Reject a BUY whose sector is in the current bottom-3 by 60d RS
// when the market is in a hard-avoid mode (regime hostile, or an
// explicit ctx.sectorHardAvoid flag set by a caller). CORE ETFs are
// exempt — sector tilt never overrides the CORE mandate. Unknown
// tickers (not in TICKER_SECTOR_MAP) are also exempt — missing map
// means no confident classification, so don't block. Soft-preference
// for leader-sector tickers stays in the prompt; this rule is only
// the hard gate.
function ruleSectorLaggardBuy({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  // Never block CORE ETFs on sector grounds.
  if (isCoreBuy(rec)) return { ok: true };
  const sectorRotation = ctx.sectorRotation;
  if (!sectorRotation?.rows?.length) return { ok: true };
  // Hard-avoid mode required — otherwise sector tilt is only a
  // preference, expressed in the prompt.
  const regimeLabel = String(ctx.tradingRegime?.label || ctx.tradingRegime?.regime || "").toLowerCase();
  const regimeHostile = /risk[- ]?off|hostile|bear|contract|distribut/i.test(regimeLabel);
  const hardAvoid = ctx.sectorHardAvoid === true || regimeHostile;
  if (!hardAvoid) return { ok: true };

  const laggards = getSectorLaggards(sectorRotation, 3);
  if (laggards.length === 0) return { ok: true };
  const laggardSyms = new Set(laggards.map(l => l.symbol));

  const sector = mapTickerToSector(rec.ticker);
  if (!sector) return { ok: true }; // unknown ticker — don't block
  if (!laggardSyms.has(sector)) return { ok: true };

  const laggardName = laggards.find(l => l.symbol === sector)?.name || sector;
  return {
    ok: false,
    reason: "sector-laggard-hard-avoid",
    detail: `BUY ${rec.ticker} maps to sector **${sector} (${laggardName})** which is in the bottom 3 by 60d RS vs SPY. Regime is hostile, so laggard-sector new buys are hard-blocked. Prefer a leader-sector ticker or a CORE ETF (XEQT/VUN/XIU/VOO).`,
  };
}

// Insert into per-rec RULES so the sector gate fires alongside
// sleeve/concentration/cap checks. Uses ctx.sectorRotation +
// ctx.tradingRegime; both are optional (rule no-ops if absent).
RULES.push(ruleSectorLaggardBuy);

const BATCH_RULES = [
  ruleBatchPairedRedeploy,
  ruleAccountFragmentation,
];

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a single rec against every rule.
 * @param {Object} rec — the parsed rec from parseRecsFromBriefing (has
 *   ticker, action, entryPrice, shares, entryCurrency, etc.)
 * @param {Object} ctx — { positions, sleeveBalance, bookCad, fxUsdCad }
 * @returns {Object} { ok, rejections: [{reason, detail}, ...] }
 */
export function validateRec(rec, ctx) {
  const rejections = [];
  for (const rule of RULES) {
    try {
      const r = rule({ rec, ctx });
      if (!r.ok) rejections.push({ reason: r.reason, detail: r.detail });
    } catch (e) {
      // A buggy validator should never crash the pipeline — log and
      // treat as pass so a rec that would otherwise be legitimate still
      // ships. Better to miss a rejection than lose the whole briefing.
      console.warn(`[rec-validator] rule crashed on ${rec.ticker}:`, e?.message);
    }
  }
  return { ok: rejections.length === 0, rejections };
}

/**
 * Bulk validate. Returns {accepted, rejected} where accepted is the
 * subset of recs safe to persist and rejected is a parallel list of
 * {rec, rejections} for logging / UI display.
 *
 * Two-phase: per-rec rules first (drop obvious violators before batch
 * analysis), then batch rules on the survivors. A rec that survives
 * per-rec validation but fails a batch rule moves from accepted →
 * rejected with the batch rule's reason attached.
 */
export function validateRecs(recs, ctx) {
  const perRecAccepted = [];
  const perRecAcceptedIdx = []; // parallel array of original indices
  const rejected = [];
  const originalRecs = recs || [];
  for (let i = 0; i < originalRecs.length; i++) {
    const rec = originalRecs[i];
    const r = validateRec(rec, ctx);
    if (r.ok) { perRecAccepted.push(rec); perRecAcceptedIdx.push(i); }
    else rejected.push({ rec, rejections: r.rejections });
  }

  // Batch phase — rules operate on the full per-rec-accepted list.
  // recIndex in each batch rejection is relative to perRecAccepted.
  const batchRejectionsByIdx = new Map(); // localIdx → [{reason, detail}, ...]
  for (const rule of BATCH_RULES) {
    try {
      const results = rule(perRecAccepted, ctx) || [];
      for (const rej of results) {
        if (!Number.isInteger(rej.recIndex)) continue;
        if (!batchRejectionsByIdx.has(rej.recIndex)) batchRejectionsByIdx.set(rej.recIndex, []);
        batchRejectionsByIdx.get(rej.recIndex).push({ reason: rej.reason, detail: rej.detail });
      }
    } catch (e) {
      console.warn(`[rec-validator] batch rule crashed:`, e?.message);
    }
  }

  const accepted = [];
  for (let localIdx = 0; localIdx < perRecAccepted.length; localIdx++) {
    const rec = perRecAccepted[localIdx];
    const rejs = batchRejectionsByIdx.get(localIdx);
    if (rejs && rejs.length > 0) rejected.push({ rec, rejections: rejs });
    else accepted.push(rec);
  }

  if (rejected.length > 0) {
    console.warn(`[rec-validator] rejected ${rejected.length}/${originalRecs.length} recs:`);
    for (const r of rejected) {
      const slugs = r.rejections.map(x => x.reason).join(", ");
      console.warn(`  ${r.rec.action} ${r.rec.ticker}: ${slugs}`);
    }
  }
  return { accepted, rejected };
}

/**
 * Build the ctx object callers need. Convenience for briefing/advice
 * sites so they don't duplicate the same computeSleeveBalance +
 * totalCad + fx wiring.
 */
export function buildValidatorContext({ positions, cashAccounts, fxUsdCad, sleeveTargets, computeSleeveBalance, sectorRotation, tradingRegime, sectorHardAvoid, livePrices, userExpectancy, liquidity }) {
  const fx = fxUsdCad || 1.37;
  const bookPositions = (positions || []).reduce((s, p) => {
    const cad = (Number.isFinite(p.priceCad) ? p.priceCad
      : Number.isFinite(p.priceUsd) ? p.priceUsd * fx : 0) * (p.qty || 0);
    return s + cad;
  }, 0);
  const bookCash = (cashAccounts || []).reduce(
    (s, a) => s + (a.cashCad || 0) + (a.cashUsd || 0) * fx, 0
  );
  const bookCad = bookPositions + bookCash;
  const sleeveBalance = computeSleeveBalance
    ? computeSleeveBalance(positions || [], fx, sleeveTargets)
    : null;
  return {
    positions: positions || [],
    sleeveBalance,
    bookCad,
    fxUsdCad: fx,
    sectorRotation: sectorRotation || null,
    tradingRegime: tradingRegime || null,
    sectorHardAvoid: sectorHardAvoid === true,
    livePrices: livePrices || {},
    userExpectancy: userExpectancy || null,
    liquidity: liquidity || {},
  };
}

// Pre-fetch avg daily $ volume for the tickers a rec batch references
// via FMP realtime quote. Returns { TICKER: { avgVolume, price,
// dailyDollarVol, currency } }. FMP handles both US and Canadian
// listings; missing key or fetch failure → empty map (rule no-ops).
// Dynamic import mirrors fetchLivePricesForRecs to avoid import cycles.
export async function fetchLiquidityForRecs(recs) {
  if (!Array.isArray(recs) || recs.length === 0) return {};
  const { getRealtimeQuote } = await import("./stocksIntradayFmp.js");
  const items = [...new Set(recs.map(r => ({
    ticker: String(r.ticker || "").toUpperCase(),
    currency: r.entryCurrency || "USD",
  })).filter(x => x.ticker).map(x => JSON.stringify(x)))].map(s => JSON.parse(s));
  const entries = await Promise.all(items.map(async ({ ticker, currency }) => {
    try {
      const q = await getRealtimeQuote(ticker, currency);
      if (!q || !Number.isFinite(q.avgVolume) || !Number.isFinite(q.price)) return [ticker, null];
      return [ticker, {
        avgVolume: q.avgVolume,
        price: q.price,
        dailyDollarVol: q.avgVolume * q.price,
        currency,
      }];
    } catch { return [ticker, null]; }
  }));
  const out = {};
  for (const [t, v] of entries) if (v) out[t] = v;
  return out;
}

// Compute overall user expectancy from AI-emitted recs that have
// closed (target-hit / stop-hit / expired) in the last `days` window.
// Aggregates ALL sourceLabels — a v1 signal to detect "the process is
// currently bleeding" without needing per-source stratification.
// Returns null-ish for underpowered samples (rule then no-ops).
export async function computeUserExpectancy({ email, days = 90 }) {
  const { default: StocksAdviceRec } = await import("../models/StocksAdviceRec.js");
  const since = new Date(Date.now() - days * 86400 * 1000);
  const recs = await StocksAdviceRec.find({
    email,
    generatedAt: { $gte: since },
    status: { $in: ["target-hit", "stop-hit", "expired"] },
    entryPrice: { $gt: 0 },
    hitPrice: { $gt: 0 },
  }).select("action entryPrice hitPrice").lean();

  const returns = [];
  for (const r of recs) {
    const dir = r.action === "BUY" ? 1 : -1;
    const ret = ((r.hitPrice - r.entryPrice) / r.entryPrice) * 100 * dir;
    if (Number.isFinite(ret)) returns.push(ret);
  }
  if (returns.length === 0) {
    return { trades: 0, expectancyPct: null, winRate: 0, proven: false };
  }
  const wins = returns.filter(x => x > 0);
  const losses = returns.filter(x => x <= 0);
  const winRate = wins.length / returns.length;
  const avgWin = wins.length ? wins.reduce((s, x) => s + x, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, x) => s + x, 0) / losses.length : 0;
  const expectancyPct = winRate * avgWin + (1 - winRate) * avgLoss;
  return {
    trades: returns.length,
    expectancyPct,
    winRate: winRate * 100,
    proven: returns.length >= 20,
  };
}

// Pre-fetch live cross-checked prices for the tickers a rec batch
// references. Pass through to ctx.livePrices via buildValidatorContext
// so ruleLivePriceDrift can consult per-ticker prices synchronously.
// Rejects nothing on fetch failure — a ticker with no live data just
// disables the drift check for that rec (the rule already no-ops).
//
// fetchOne is imported lazily to avoid the routes → services import
// cycle that would form if this file top-level imported stocksPrices.
export async function fetchLivePricesForRecs(recs) {
  if (!Array.isArray(recs) || recs.length === 0) return {};
  const { fetchOne } = await import("../routes/stocksPrices.js");
  const uniqueTickers = [...new Set(recs.map(r => String(r.ticker || "").toUpperCase()).filter(Boolean))];
  const entries = await Promise.all(uniqueTickers.map(async (t) => {
    try {
      const live = await fetchOne(t);
      return [t, live];
    } catch { return [t, null]; }
  }));
  const out = {};
  for (const [t, live] of entries) if (live) out[t] = live;
  return out;
}
