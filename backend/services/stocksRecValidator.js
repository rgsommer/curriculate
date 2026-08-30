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
//   missing-sleeve                    — rec has no sleeve declaration
//   sleeve-mismatch                   — declared sleeve doesn't match classifier
//   missing-horizon                   — rec has no horizonDays declaration
//   sleeve-spec-cap-hard              — BUY on SPEC when SPEC is at/over
//                                       (target − 0.5pp buffer)
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
//   gap-extension                     — BUY on a ticker that's already
//                                       moved ≥8% vs prior close today
//                                       (setup consumed / gap chase)
//   min-reward-risk                   — BUY whose (target-entry)/(entry-stop)
//                                       is below 1.5 (inverted payoff — wide
//                                       stops laundered as small size)
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

// Whitelist of allowed smart-money signal sources. When a SPEC BUY
// declares one of these, the thesis IS "follow the smart money" —
// congressional trades / Form 4 insider clusters / unusual options
// flow — and the standard SPEC gate (thesisHorizonMonths + structural
// driver text) is bypassed. In exchange, position size is HARD-CAPPED
// at 0.5% of book per rec (per-rec) and 2% of book aggregate across
// the batch. This prevents the AI from rebadging a chart-pattern pick
// as a smart-money-follow to sneak past the SPEC gate.
const SMART_MONEY_SIGNAL_SOURCES = new Set([
  "congressional-follow",
  "insider-cluster-buy",
  "unusual-options-flow",
]);
const SMART_MONEY_PER_REC_CAP_PCT = 0.5;   // 0.5% of book per position
const SMART_MONEY_AGGREGATE_CAP_PCT = 2.0; // 2% of book across all smart-money BUYs in the batch

// ─────────────────────────────────────────────────────────────────────
// Individual gate functions. Each: (rec, ctx) → { ok, reason?, detail? }
// ─────────────────────────────────────────────────────────────────────

// SPEC over cap is a hard block on any new SPEC BUY. The briefing prompt
// already tells the AI this, but the AI still emits SPEC recs
// occasionally (e.g. the July 31 briefing surfaced ZETA with
// "spec-sleeve already 4.7pp over limit"). The validator refuses
// regardless of AI reasoning.
// SPEC cap has a 0.5pp buffer below the target — reject new SPEC BUYs
// when the sleeve is already at or over (target − buffer). Prevents
// the "just under cap → sneak in one more" accumulation pattern that
// wastes cap headroom on a marginal add. Per Grok audit.
const SPEC_CAP_BUFFER_PP = 0.5;
function ruleSpecCapHard({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const sleeve = classifyPosition({ ticker: rec.ticker });
  if (sleeve !== "spec") return { ok: true };
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct) return { ok: true }; // no context — don't block
  const specPct = bal.actualPct.spec;
  const specTargetPct = bal.targetsPct?.spec ?? 5;
  const effectiveCap = specTargetPct - SPEC_CAP_BUFFER_PP;
  if (specPct < effectiveCap) return { ok: true };
  return {
    ok: false,
    reason: "sleeve-spec-cap-hard",
    detail: `SPEC sleeve at ${specPct.toFixed(1)}% is at/over the buffered cap ${effectiveCap.toFixed(1)}% (target ${specTargetPct}% − ${SPEC_CAP_BUFFER_PP}pp buffer). New SPEC BUYs are hard-blocked until the sleeve shrinks below the buffered cap. AI proposed BUY ${rec.ticker} anyway — rejected.`,
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
  // 20% single-name cap — aligned with the §1 TRIM CONCENTRATION
  // mandate in the briefing renderer. CORE ETFs are NOT exempted
  // (per user directive Aug 5): a broad-market ETF at 20%+ is still
  // 20%+ tied to one specific index. Spread CORE across multiple ETFs.
  const CAP_PCT = 20;
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

// Gap-extension gate: reject a BUY when the ticker has moved
// materially since prior close — you shouldn't chase an
// earnings-day / news-day gap in size. PLTR case: pick generated
// at $158.40 pre-earnings; overnight gap took price to $159.57
// (+27% vs prior close $125.65). The AI treated the rec as still
// valid and re-emitted with entry = current + tiny buffer, which
// is exactly the "chase the top of the move" pattern. Rule blocks
// this regardless of whether the rec's entryPrice matches the
// current price — the disqualifier is the SESSION MOVE, not
// entry-vs-live drift.
// Missing priorClose → rule no-ops (don't block on unavailable data).
// Gap-extension floor (audit Aug-28): was 8% for every BUY, which
// systematically blocked entry the day after every earnings beat,
// guidance raise, or short squeeze — exactly when winners announce
// themselves. Widened to 15% and scoped to SWING sleeve only. CORE
// remains exempt (rebalance, not R/R). SPEC exempt (asymmetric — a
// 20% gap on a $500M name is often the actual signal). SWING keeps
// the "don't chase mid-move" discipline but at a level that no longer
// filters out post-earnings continuation entries.
const GAP_EXTENSION_PCT = 15.0;
function ruleGapExtension({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  if (isCoreBuy(rec)) return { ok: true };
  // Only enforce for SWING sleeve. SPEC's whole thesis is asymmetric
  // upside — blocking a 12% gap on a small-cap catalyst breakout is
  // exactly the "miss the next NVDA" pattern the audit flagged.
  const sleeve = String(rec.sleeve || "").toLowerCase();
  if (sleeve && sleeve !== "swing") return { ok: true };
  const live = ctx.livePrices?.[String(rec.ticker).toUpperCase()];
  if (!live || !(live.price > 0) || !(live.priorClose > 0)) return { ok: true };
  const movePct = ((live.price - live.priorClose) / live.priorClose) * 100;
  if (Math.abs(movePct) < GAP_EXTENSION_PCT) return { ok: true };
  const dir = movePct >= 0 ? "up" : "down";
  return {
    ok: false,
    reason: "gap-extension",
    detail: `BUY ${rec.ticker} (SWING) rejected — ticker is ${dir} ${movePct.toFixed(1)}% vs prior close $${live.priorClose.toFixed(2)} (now $${live.price.toFixed(2)}). Same-day move ≥ ${GAP_EXTENSION_PCT}% on a SWING setup means chase-territory — the R/R is compressed and the setup is either consumed (up-gap chase) or invalidated (down-gap thesis break). Wait for digestion, then reset entry / stop / target on fresh structure. (SPEC + CORE sleeves are exempt from this floor.)`,
  };
}

// Reward-to-risk floor: reject any BUY whose (target - entry) /
// (entry - stop) ratio is below a minimum. This catches the PLTR-class
// failure — target $163.70 vs entry $159.50 vs stop $137.52 = R:R of
// (4.20 / 22.00) = 0.19. Even if the setup wins outright, the payoff
// is a fifth of the risk. Wide stops laundered as "small size" don't
// fix inverted payoffs; they just limit the damage. CORE ETFs are
// exempt (they're not R:R plays — they're sleeve rebalances). Recs
// missing target or stop are also exempt (can't compute ratio).
const MIN_REWARD_RISK = 1.5;
function ruleMinRewardRisk({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  if (isCoreBuy(rec)) return { ok: true };
  const entry = rec.entryPrice;
  const target = rec.targetPrice;
  const stop = rec.stopPrice;
  if (!(entry > 0) || !(target > 0) || !(stop > 0)) return { ok: true };
  const reward = target - entry;
  const risk = entry - stop;
  if (!(reward > 0) || !(risk > 0)) return { ok: true }; // degenerate — skip
  const ratio = reward / risk;
  if (ratio >= MIN_REWARD_RISK) return { ok: true };
  return {
    ok: false,
    reason: "min-reward-risk",
    detail: `BUY ${rec.ticker} @ $${entry} target $${target} stop $${stop} → reward-to-risk = ${ratio.toFixed(2)} (needs ≥ ${MIN_REWARD_RISK}). You are risking $${risk.toFixed(2)}/sh to make $${reward.toFixed(2)}/sh. Wide stops laundered as "small size" don't fix an inverted payoff — this setup fails its own math. Rewrite with a target ≥ entry + ${(risk * MIN_REWARD_RISK).toFixed(2)} or a stop tighter than $${(entry - reward / MIN_REWARD_RISK).toFixed(2)}, or drop the rec.`,
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
const PRICE_DRIFT_THRESHOLD = 0.006; // 0.6% — tightened again per Grok Aug rule set. Post-intraday recs (limit set from the current print) shouldn't drift more than 0.5-1.0% by the time validation runs. Anything wider almost always means AI wrote entry from stale technicals or a pre-market snapshot that has since moved.
// Phase 1 hard gate: every BUY / ADD rec must have a verified live
// price in ctx.livePrices (stamped provenance:"verified" by the
// integrity layer). If the price isn't there, the market-data layer
// refused it — likely a bad ticker resolution, cross-source
// disagreement, or a sub-dime feed anomaly. Do not let a rec ride on
// an unverified price. SELL / TRIM / EXIT skip the gate; those are
// operator-mandated exits and shouldn't be blocked by transient feed
// noise on the way out.
function ruleMarketDataProvenance({ rec, ctx }) {
  const action = String(rec.action || "").toUpperCase();
  if (action !== "BUY" && action !== "ADD") return { ok: true };
  const live = ctx.livePrices?.[String(rec.ticker).toUpperCase()];
  if (!live) {
    return {
      ok: false,
      reason: "no-verified-price",
      detail: `${rec.action} ${rec.ticker}: market-data integrity layer returned no verified price (bad ticker, cross-source disagreement, or feed anomaly). Refusing to accept a rec on an unverifiable price.`,
    };
  }
  if (live.provenance !== "verified") {
    return {
      ok: false,
      reason: "unverified-price-provenance",
      detail: `${rec.action} ${rec.ticker}: live price present but provenance="${live.provenance || "unknown"}" (expected "verified"). Every rec must trace to marketDataIntegrity.getVerifiedPrice().`,
    };
  }
  return { ok: true };
}

function ruleLivePriceDrift({ rec, ctx }) {
  if (!rec.entryPrice || !rec.ticker) return { ok: true };
  // Exits (SELL / TRIM / EXIT) are mandated exits — the operator
  // places a limit close to the current market at execution time. The
  // rec's entryPrice is a reference point, not a trigger the AI needs
  // to hit precisely. Enforcing tight drift here rejects mandatory
  // exits any time the market moves 0.6% in the minutes between AI
  // generation and validation, which is nonsense — the exit is
  // authored by a §1 mandate, not by the AI picking a limit level.
  const action = String(rec.action || "").toUpperCase();
  if (action === "SELL" || action === "TRIM" || action === "EXIT") return { ok: true };
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

// Sleeve declaration required + cross-checked against the classifier.
// Every non-HOLD rec must name its sleeve; if AI can't say what sleeve
// a ticker belongs to, they haven't thought through the trade. Also
// catches the "declare sleeve=core to sneak past sleeve caps" pattern
// by cross-checking against the deterministic classifier — mismatch
// rejects the rec, forcing either the ticker's classifier mapping to
// be updated (proper) or the rec to be re-emitted with the true sleeve
// (which then hits the correct cap/gap rules).
function ruleSleeveDeclaration({ rec, ctx }) {
  if (rec.action === "HOLD") return { ok: true };
  const declared = rec.sleeve;
  if (!declared) {
    return {
      ok: false,
      reason: "missing-sleeve",
      detail: `${rec.action} ${rec.ticker} rejected — sleeve field missing and classifier fallback failed. This shouldn't normally happen (parser auto-fills from classifier when AI omits sleeve).`,
    };
  }
  // When the parser auto-filled sleeve from the classifier (because
  // AI omitted the field), there's no "declared vs derived" to
  // cross-check — they're the same value by construction. Skip.
  if (rec._sleeveAutoFilled) return { ok: true };
  // Exits (SELL / TRIM / EXIT) close whatever position exists — the
  // AI's declared sleeve is largely cosmetic since the trade will
  // affect whichever sleeve the position is actually in. Rejecting
  // a SELL for sleeve-mismatch blocks the user from getting rid of
  // a losing position over a classification quibble. Only enforce
  // the classifier match on new BUY-side entries where sleeve
  // caps / gap rules downstream actually depend on it.
  const action = String(rec.action || "").toUpperCase();
  if (action === "SELL" || action === "TRIM" || action === "EXIT") return { ok: true };
  const derived = classifyPosition({ ticker: rec.ticker });
  if (String(declared).toLowerCase() !== derived) {
    return {
      ok: false,
      reason: "sleeve-mismatch",
      detail: `${rec.action} ${rec.ticker} declared sleeve="${declared}" but classifier maps this ticker to "${derived}" (via CORE_ETFS / INCOME_TICKERS / SWING_TICKERS / SPEC_TICKERS / TSX-default rules). Either the ticker belongs in a different sleeve than you think, or the classifier list needs updating. Rejected.`,
    };
  }
  return { ok: true };
}

// Horizon required on every non-HOLD rec. If you can't state how long
// you'd hold this trade, you're not committing to a plan — you're
// hoping. horizonDays is now null (not the old silent 30-day default)
// when AI omits it, so this rule catches the omission cleanly.
function ruleHorizonDeclaration({ rec, ctx }) {
  if (rec.action === "HOLD") return { ok: true };
  // Exits close a position — there's no "hold period" to declare. The
  // horizon concept applies to opening a new BUY (how long you intend
  // to hold before exit). SELL / TRIM / EXIT are the exit itself, so
  // requiring horizonDays on them is a category error.
  const action = String(rec.action || "").toUpperCase();
  if (action === "SELL" || action === "TRIM" || action === "EXIT") return { ok: true };
  if (!(rec.horizonDays > 0)) {
    return {
      ok: false,
      reason: "missing-horizon",
      detail: `${rec.action} ${rec.ticker} rejected — horizonDays missing or invalid. Every rec must declare an intended holding period (integer days: weeks × 7, months × 30). Missing horizon = missing exit plan.`,
    };
  }
  return { ok: true };
}

// Regime hard gate: when the regime module flags an unfavourable tape
// (risk-off / hostile / bear / contraction / distribution), block any
// new BUY that isn't a CORE ETF. CORE keeps flowing so the sleeve
// stays healthy even in bear regimes; discretionary SWING/SPEC entries
// are what regime hostility is meant to suppress. Composes cleanly
// with ruleSectorLaggardBuy (which handles a narrower "hostile AND
// laggard sector" case for CORE-adjacent tickers).
// Horizon ↔ stop-regime matching. The forbidden combos are (a) a
// short horizon with a wide stop (thesis clock runs out long before
// the stop matters — you're really running a long-hold with a fake
// exit plan) and (b) a long horizon with a tight stop (normal noise
// stops you out weeks before the thesis has time to work). Per user
// Aug 5 overhaul spec §2 — the primary source of the well-behind
// cluster is horizon/stop mismatch on entry.
//
// Bands (stop distance = |entry - stop| / entry × 100):
//   short  ≤ 45d  → 3–8% stop  (tight ATR/percentage — no overrides)
//   medium 46–180d → 5–15% stop
//   long   ≥ 181d → 8–30% stop (volatility stop or time-based review)
//
// Skips SELL/TRIM/EXIT (exit-side has no horizon concept) and any
// rec where entryPrice or stopPrice is missing (other rules catch
// those).
function ruleHorizonStopMatch({ rec, ctx }) {
  const action = String(rec.action || "").toUpperCase();
  if (action === "HOLD" || action === "SELL" || action === "TRIM" || action === "EXIT") return { ok: true };
  if (!(rec.horizonDays > 0)) return { ok: true }; // ruleHorizonDeclaration handles this
  if (!(rec.entryPrice > 0) || !(rec.stopPrice > 0)) return { ok: true }; // stop rule handles
  const stopPct = Math.abs(rec.entryPrice - rec.stopPrice) / rec.entryPrice * 100;
  const h = rec.horizonDays;
  let allowedMin, allowedMax, band;
  if (h <= 45) { allowedMin = 3; allowedMax = 8; band = "short (≤45d)"; }
  else if (h <= 180) { allowedMin = 5; allowedMax = 15; band = "medium (46-180d)"; }
  else { allowedMin = 8; allowedMax = 30; band = "long (≥181d)"; }
  if (stopPct < allowedMin) {
    return {
      ok: false,
      reason: "horizon-stop-mismatch-too-tight",
      detail: `${rec.action} ${rec.ticker} horizon ${h}d (${band}) with stop only ${stopPct.toFixed(1)}% from entry. Too tight for the holding period — normal noise will stop you out weeks before the thesis has time to work. Minimum for this horizon: ${allowedMin}%. Either widen the stop or shorten the horizon.`,
    };
  }
  if (stopPct > allowedMax) {
    return {
      ok: false,
      reason: "horizon-stop-mismatch-too-wide",
      detail: `${rec.action} ${rec.ticker} horizon ${h}d (${band}) with stop ${stopPct.toFixed(1)}% from entry. Too wide for the horizon — the thesis clock runs out long before the stop matters. Maximum for this horizon: ${allowedMax}%. Either tighten the stop or lengthen the horizon.`,
    };
  }
  return { ok: true };
}

// High-conviction SPEC gate. New SPEC-sleeve BUYs must declare a
// multi-month thesis AND a structural driver — otherwise it's just a
// technical pattern dressed up as a swing thesis, which is where the
// bleed came from. Per user Aug 5 overhaul §3: silent auto-reject
// pre-persist; the AI must write both fields or drop the rec.
//
// thesisHorizonMonths: integer months you'd hold the thesis independent
//   of intraday noise (≥3 = quarter-plus). Prevents the "5-day pocket
//   pivot" from being sold as a SPEC hold.
// structuralDriver: one-line description of the durable catalyst
//   (regulatory tailwind, secular demand shift, macro regime, new
//   product cycle). "Pocket pivot scored 84" is NOT a structural
//   driver — it's a chart pattern.
// Chart-pattern / short-term language that CANNOT stand alone as a
// structural driver. Note (audit Aug-28): we narrowed this to genuine
// pure-technical vocabulary. "momentum", "breakout", "hot sector",
// "leadership acceleration", "post-earnings continuation" were REMOVED
// — those describe legitimate durable investment drivers (a company
// with accelerating relative strength IS a momentum-leader thesis; a
// stock breaking out to new all-time highs on volume after an earnings
// beat has real information content). Prior list blocked every
// momentum-driven SPEC thesis by regex — banning the vocabulary of
// exactly the archetype we want to discover.
const DRIVER_TECHNICAL_PATTERNS = /\b(pocket\s*pivot|bull\s*flag|bear\s*flag|coiled\s*spring|vcp|cup\s*and\s*handle|inside\s*day|rvol\s*spike|rvol\s*>?\s*\d|rsi\s*(over|under|<|>)|chart\s*pattern|moving\s*average\s*cross|golden\s*cross|death\s*cross|macd\s*cross|fibonacci\s*retrace|fib\s*level|sma\s*\d+|ema\s*\d+|rsi\s*\d+|technical\s*setup|setup\s*(scored|scoring))\b/gi;
// Durable-driver vocabulary — at least one hit REQUIRED. Signals the
// thesis references business fundamentals, industry structure, supply/
// demand, competitive position, regulatory/policy change, or a
// multi-year / secular horizon.
const DRIVER_DURABLE_VOCAB = /\b(multi[- ]?year|secular|structural|durable|regulatory|policy|legislation|supply[- ]?demand|supply\s*constraint|demand\s*shift|capex\s*cycle|capital\s*cycle|infrastructure\s*build|infrastructure\s*shift|competitive\s*advantage|moat|market\s*share|pricing\s*power|switching\s*cost|network\s*effect|monopoly|oligopoly|dislocation|mispricing|balance\s*sheet|free\s*cash\s*flow|fcf|return\s*on\s*capital|roic|roce|dividend\s*(growth|history)|capital\s*allocation|management\s*quality|earnings\s*power|margin\s*expansion|tailwind|demographic|adoption\s*curve|penetration|reshoring|onshoring|energy\s*transition|electrification|ai\s*infrastructure|data\s*center|cloud\s*build[- ]?out|semiconductor\s*cycle|inventory\s*cycle|commodity\s*cycle|interest[- ]?rate\s*cycle|rate\s*cycle|monetary\s*regime|inflation\s*regime|deflation)\b/i;
function ruleHighConvictionSpecGate({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const sleeve = String(rec.sleeve || "").toLowerCase();
  if (sleeve !== "spec") return { ok: true };
  // Smart-money-follow bypass. When the SPEC thesis IS "piggyback a
  // public congressional / insider / options-flow filing", the SPEC
  // gate's thesisHorizonMonths + structuralDriver checks don't apply
  // — the smart-money signal IS the thesis. Size is capped separately
  // by ruleSmartMoneySizeCap (per-rec) + ruleBatchSmartMoneyAggregateCap
  // (batch), so the bypass can't be abused to load up on a name.
  if (SMART_MONEY_SIGNAL_SOURCES.has(String(rec.signalSource || "").toLowerCase())) {
    console.log(`[spec-gate] smart-money bypass for BUY ${rec.ticker} via ${rec.signalSource}`);
    return { ok: true };
  }
  const months = Number(rec.thesisHorizonMonths);
  if (!Number.isFinite(months) || months < 3) {
    return {
      ok: false,
      reason: "thesisHorizonMonths_below_3",
      detail: `BUY ${rec.ticker} rejected — SPEC sleeve requires thesisHorizonMonths ≥ 3 (multi-month hold thesis). Got ${rec.thesisHorizonMonths ?? "missing"}. A SPEC entry is a bet on a durable driver, not a technical pattern; if you can't state months, you don't have a SPEC thesis.`,
    };
  }
  const driver = String(rec.structuralDriver || "").trim();
  if (!driver || driver.length < 15) {
    return {
      ok: false,
      reason: "missing_or_invalid_structuralDriver",
      detail: `BUY ${rec.ticker} rejected — SPEC sleeve requires a structuralDriver field (regulatory tailwind, secular demand shift, macro regime, product cycle, etc). Got "${rec.structuralDriver ?? "missing"}". "Pocket pivot scored 84" or "bull flag" is NOT a structural driver — it's a chart pattern. Every SPEC bet must name the multi-quarter forcing function.`,
    };
  }
  if (driver.length > 300) {
    return {
      ok: false,
      reason: "missing_or_invalid_structuralDriver",
      detail: `BUY ${rec.ticker} rejected — structuralDriver is ${driver.length} characters, over the 300-char limit. State the driver crisply in 15-300 characters; walls of text usually mean the thesis isn't clear.`,
    };
  }
  // Lightweight quality check on the driver text itself. Per user
  // Aug 5 overhaul §2:
  //   (a) Reject if dominated by short-term chart-pattern language.
  //   (b) Reject if it contains no durable-driver vocabulary (no
  //       reference to business, industry structure, supply/demand,
  //       regulation, secular horizon, etc).
  const patternHits = (driver.match(DRIVER_TECHNICAL_PATTERNS) || []).length;
  const durableHit = DRIVER_DURABLE_VOCAB.test(driver);
  // "Dominated by pattern language" = ≥2 pattern references AND no
  // durable-driver reference. One casual chart-mention alongside a
  // real driver is fine ("secular AI infra tailwind + bull flag
  // setup for entry"), but "bull flag with pocket pivot on RVOL
  // spike" is chart-only.
  if (patternHits >= 2 && !durableHit) {
    return {
      ok: false,
      reason: "missing_or_invalid_structuralDriver",
      detail: `BUY ${rec.ticker} rejected — structuralDriver text is dominated by short-term chart-pattern language ("${driver}"). Chart patterns are timing, not thesis. Name the multi-quarter business driver: regulatory shift, supply/demand inflection, capital-allocation quality, secular adoption curve, etc.`,
    };
  }
  if (!durableHit) {
    return {
      ok: false,
      reason: "missing_or_invalid_structuralDriver",
      detail: `BUY ${rec.ticker} rejected — structuralDriver text ("${driver}") contains no reference to business fundamentals, industry structure, supply/demand, competitive position, regulation, or a multi-year horizon. State the durable forcing function explicitly, not just "AI is big" / "sector is hot" / "momentum is strong".`,
    };
  }
  return { ok: true };
}

// Smart-money-follow position size cap. When a BUY declares a
// signalSource in SMART_MONEY_SIGNAL_SOURCES, the SPEC gate is
// bypassed but the position is HARD-CAPPED at 0.5% of book. This
// prevents the bypass from being abused to size a nominal-thesis
// BUY at normal SPEC weight. Missing sleeveBalance.book → no-op
// (don't block on missing data). The 2% aggregate cap across all
// smart-money BUYs in a batch is enforced by ruleBatchSmartMoneyAggregateCap.
function ruleSmartMoneySizeCap({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const src = String(rec.signalSource || "").toLowerCase();
  if (!SMART_MONEY_SIGNAL_SOURCES.has(src)) return { ok: true };
  const bookCad = ctx.sleeveBalance?.book;
  if (!(bookCad > 0)) return { ok: true };
  const shares = rec.shares;
  const price = rec.entryPrice;
  if (!(shares > 0) || !(price > 0)) return { ok: true }; // unsized rec — skip
  const fx = ctx.fxUsdCad || 1.37;
  const positionCad = rec.entryCurrency === "USD" ? shares * price * fx : shares * price;
  const positionPct = (positionCad / bookCad) * 100;
  if (positionPct <= SMART_MONEY_PER_REC_CAP_PCT) return { ok: true };
  return {
    ok: false,
    reason: "smart-money-position-cap",
    detail: `BUY ${shares} sh ${rec.ticker} @ $${price} (${rec.entryCurrency || "USD"}) via ${src} would size to ${positionPct.toFixed(2)}% of book, above the ${SMART_MONEY_PER_REC_CAP_PCT}% per-position cap for smart-money-follow entries. Piggyback trades ride other people's conviction — size accordingly. Downsize to ≤ ${Math.floor((SMART_MONEY_PER_REC_CAP_PCT / 100 * bookCad) / (rec.entryCurrency === "USD" ? price * fx : price))} shares or drop the rec.`,
  };
}

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
  // Field-declaration gates run first — cheap and catch "AI didn't
  // think this through" recs before they hit the more expensive
  // classifier / live-price / sleeve rules.
  ruleSleeveDeclaration,
  ruleHorizonDeclaration,
  ruleHorizonStopMatch,
  ruleHighConvictionSpecGate,
  ruleSmartMoneySizeCap,
  ruleSpecCapHard,
  ruleCoreGapWidening,
  ruleSingleNameCap,
  ruleRegimeHostileNoNewSwingSpec,
  ruleMarketDataProvenance,
  ruleLivePriceDrift,
  ruleGapExtension,
  ruleMinRewardRisk,
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
  // BUY can only cover ONE SELL (proceeds don't multiply). Pairing
  // requires SAME ACCOUNT and SAME CURRENCY — no any-account fallback,
  // no cross-currency fallback. Proceeds do not automatically cross
  // account or currency boundaries; an any-account "match" that then
  // relies on a downstream reject to save the trade is architecturally
  // wrong. If no eligible destination exists in the exact bucket, the
  // SELL is naked and the operator has to either add a matching BUY
  // or drop the SELL.
  const coreBuys = list
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isCoreBuy(r));
  const usedCoreBuyIdx = new Set();

  const rejections = [];

  const ccyOf = (r) => String(r?.entryCurrency || r?.currency || "").toUpperCase();

  // For each SELL: find a CORE BUY that is in the SAME account AND
  // SAME currency. No fallback. Match one-to-one.
  for (const { r: sell, i: sellIdx } of sells) {
    const sellCcy = ccyOf(sell);
    const match = coreBuys.find(({ r, i }) => {
      if (usedCoreBuyIdx.has(i)) return false;
      // Same account (or missing on both, treat as compatible pending
      // full account threading — sameAccount already handles nulls).
      if (!sameAccount(sell.account, r.account)) return false;
      // Same currency. If either side is missing currency, require
      // both to be missing — do NOT silently cross currencies.
      const buyCcy = ccyOf(r);
      if (sellCcy || buyCcy) {
        if (sellCcy !== buyCcy) return false;
      }
      return true;
    });

    if (!match) {
      rejections.push({
        recIndex: sellIdx,
        reason: "sell-no-same-bucket-redeploy",
        detail:
          `${sell.action} ${sell.ticker} in ${sell.account || "?"} (${sellCcy || "?"}) ` +
          `has no companion CORE BUY in the SAME account AND SAME currency in this batch, ` +
          `and CORE is ${coreGap.toFixed(1)}pp underweight. Proceeds cannot cross account ` +
          `or currency boundaries without an explicit FX/transfer leg — no fallback pairing. ` +
          `Either add a CORE BUY (XEQT / VUN / XIU / VOO / VTI / …) in the SAME ` +
          `${sell.account || "?"} ${sellCcy || ""} bucket, or drop the ${sell.action}.`,
      });
      continue;
    }

    usedCoreBuyIdx.add(match.i);
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

// Aggregate smart-money-follow exposure cap. Sums the CAD value of
// every accepted BUY that declares a smart-money signalSource; if the
// batch total exceeds SMART_MONEY_AGGREGATE_CAP_PCT of book, reject
// the smallest-first until the pool fits under the cap. Rejecting
// smallest-first (rather than largest-first) keeps the highest-signal
// / highest-conviction smart-money entries and drops the marginal
// piles-on. Missing sleeveBalance.book → no-op.
function ruleBatchSmartMoneyAggregateCap(recs, ctx) {
  const bookCad = ctx.sleeveBalance?.book;
  if (!(bookCad > 0)) return [];
  const fx = ctx.fxUsdCad || 1.37;
  const list = recs || [];
  const smart = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.action !== "BUY") continue;
    const src = String(r.signalSource || "").toLowerCase();
    if (!SMART_MONEY_SIGNAL_SOURCES.has(src)) continue;
    const shares = r.shares || 0;
    const price = r.entryPrice || 0;
    if (!(shares > 0) || !(price > 0)) continue;
    const cad = r.entryCurrency === "USD" ? shares * price * fx : shares * price;
    smart.push({ recIndex: i, cad, rec: r });
  }
  const totalCad = smart.reduce((s, x) => s + x.cad, 0);
  const capCad = (SMART_MONEY_AGGREGATE_CAP_PCT / 100) * bookCad;
  if (totalCad <= capCad) return [];
  // Sort ascending — reject smallest-first until we fit under the cap.
  smart.sort((a, b) => a.cad - b.cad);
  const rejections = [];
  let running = totalCad;
  for (const entry of smart) {
    if (running <= capCad) break;
    rejections.push({
      recIndex: entry.recIndex,
      reason: "smart-money-aggregate-cap",
      detail: `BUY ${entry.rec.ticker} rejected — batch smart-money-follow exposure ($${Math.round(totalCad).toLocaleString()} CAD across ${smart.length} recs) exceeds the ${SMART_MONEY_AGGREGATE_CAP_PCT}% aggregate cap ($${Math.round(capCad).toLocaleString()} CAD). Smart-money piggybacks are HIGH-VOL by construction — the aggregate cap prevents them from becoming a stealth sleeve. Dropped smallest-first; keep the highest-conviction few.`,
    });
    running -= entry.cad;
  }
  return rejections;
}

const BATCH_RULES = [
  ruleBatchPairedRedeploy,
  ruleAccountFragmentation,
  ruleBatchSmartMoneyAggregateCap,
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
    // Tier 2.3 (audit Aug-28): persist rejections to StocksRejectionLog
    // so the redesign has a queryable "candidates we rejected and why"
    // corpus. Fire-and-forget — persistence failure never blocks the
    // briefing. Requires ctx.email + ctx.generatedAt (both optional;
    // when missing the persistence is skipped silently).
    if (ctx?.email && ctx?.generatedAt) {
      persistRejectionsAsync(rejected, {
        email: ctx.email,
        generatedAt: ctx.generatedAt,
        sessionKey: ctx.sessionKey || null,
        origin: "validator",
      });
    }
  }
  return { accepted, rejected };
}

// Async, non-blocking persistence for rejected recs. Kept out of the
// validateRecs synchronous return path so a Mongo hiccup can't stall
// a briefing send.
async function persistRejectionsAsync(rejected, { email, generatedAt, sessionKey, origin }) {
  try {
    const { default: StocksRejectionLog } = await import("../models/StocksRejectionLog.js");
    const docs = [];
    for (const r of rejected) {
      const rec = r.rec || {};
      // A single rec can have multiple rejection reasons — one doc per
      // (rec, reason) so per-reason aggregations are trivial.
      for (const rej of r.rejections || []) {
        docs.push({
          email,
          generatedAt,
          ticker: String(rec.ticker || "").toUpperCase(),
          action: String(rec.action || "?").toUpperCase(),
          origin,
          reason: rej.reason || "unknown",
          detail: rej.detail || null,
          snapshot: {
            entryPrice: rec.entryPrice ?? null,
            targetPrice: rec.targetPrice ?? null,
            stopPrice: rec.stopPrice ?? null,
            horizonDays: rec.horizonDays ?? null,
            sleeve: rec.sleeve ?? null,
            sourceLabel: rec.sourceLabel ?? null,
            structuralDriver: rec.structuralDriver ?? null,
            thesisHorizonMonths: rec.thesisHorizonMonths ?? null,
          },
          sessionKey,
        });
      }
    }
    if (docs.length > 0) {
      await StocksRejectionLog.insertMany(docs, { ordered: false }).catch((e) => {
        console.warn("[rec-validator] rejection log insertMany failed:", e?.message);
      });
    }
  } catch (e) {
    console.warn("[rec-validator] rejection persistence threw:", e?.message);
  }
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

// Resolve the exchange symbol used to hit Yahoo/FMP. Mirrors resolveSymbol
// in stocksTechnicals.js so a CAD-currency rec (e.g. TD @ CAD) fetches the
// TSX listing (TD.TO) instead of the US ADR. Without this, the drift check
// compares a rec entry priced in CAD against a US-listing price returned by
// the bare ticker fetch — a systemic mismatch that misfires on every CAD
// name (Aug 6 briefing showed TD current price coming from the US listing).
function resolveExchangeSymbol(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (!t) return t;
  if (t.includes(".")) return t; // already exchange-qualified
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

// Pre-fetch live cross-checked prices for the tickers a rec batch
// references. Pass through to ctx.livePrices via buildValidatorContext
// so ruleLivePriceDrift can consult per-ticker prices synchronously.
// Rejects nothing on fetch failure — a ticker with no live data just
// disables the drift check for that rule (the rule already no-ops).
//
// Keyed by the BARE rec ticker (the rule reads livePrices[rec.ticker]),
// but the fetch itself uses the currency-aware exchange symbol so the
// price actually reflects the exchange the rec was authored against.
//
// fetchOne is imported lazily to avoid the routes → services import
// cycle that would form if this file top-level imported stocksPrices.
export async function fetchLivePricesForRecs(recs) {
  if (!Array.isArray(recs) || recs.length === 0) return {};
  // Phase 1: route every validator live-price lookup through the
  // market-data integrity layer instead of raw fetchOne. Same source
  // (fetchOne under the hood) plus explicit sanity gates + 60s cache
  // dedup + a "provenance: verified" stamp downstream rules use to
  // prove the price wasn't invented by the LLM.
  const { getVerifiedPrice } = await import("./marketDataIntegrity.js");
  // Dedupe per (bare rec-ticker, currency). Two recs on the same bare
  // ticker in different currency accounts (rare but possible) each
  // resolve independently; the output map keys back to the bare
  // ticker the drift rule looks up.
  const seen = new Map(); // `${bare}|${ccy}` → { bare, ccy }
  for (const r of recs) {
    const bare = String(r.ticker || "").toUpperCase().trim();
    if (!bare) continue;
    const ccy = r.entryCurrency || "USD";
    const key = `${bare}|${ccy}`;
    if (!seen.has(key)) seen.set(key, { bare, ccy });
  }
  const entries = await Promise.all([...seen.values()].map(async ({ bare, ccy }) => {
    try {
      const v = await getVerifiedPrice(bare, ccy);
      if (!v.ok) return [bare, null];
      // Shape-compatible with the previous fetchOne output so
      // ruleLivePriceDrift keeps working; plus provenance + warnings
      // for the new ruleMarketDataProvenance gate.
      return [bare, {
        price: v.price,
        priorClose: v.prevClose,
        changePct: v.changePct,
        currency: v.currency,
        sources: v.sources,
        confidence: v.confidence,
        provenance: "verified",
        warnings: v.warnings || [],
        resolvedTicker: v.ticker,
      }];
    } catch { return [bare, null]; }
  }));
  const out = {};
  for (const [t, live] of entries) if (live) out[t] = live;
  return out;
}
