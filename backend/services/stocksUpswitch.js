// backend/services/stocksUpswitch.js
//
// Portfolio upswitch engine — the "am I holding X only because I already
// own it, when Y is demonstrably better?" question.
//
// Every held position is scored on the SAME multi-factor composite the
// candidate pool uses (technical + fundamentals + growth + estimate
// revisions + relative strength + insider). For every weakest incumbent
// we search the strongest challengers (same currency preferred), apply a
// sleeve-specific replacement hurdle, factor in tax placement and
// transaction cost, and emit an upswitch recommendation ONLY when the
// net advantage clears the hurdle. When no challenger clears, we
// explicitly return an empty opportunities list — no forced churn.
//
// Sleeve hurdles (composite-score delta the challenger must beat by):
//   SWING   +15  (aggressive competition for capital)
//   SPEC    +20  (require strong asymmetric upside AND respect the cap)
//   INCOME  +25  (challenger must beat on income/fundamentals/total-return)
//   CORE    +40  (extremely high; CORE is stability, not a rotation deck)
//
// Tax adjustment (subtracted from the challenger's advantage):
//   TFSA / RRSP / RRIF / LIRA / LIF / FHSA / RESP → 0  (tax-advantaged)
//   Individual / Non-Spousal / Corporate / Trust / Other → 5 (rough proxy
//     for capital-gain drag; the exact number depends on unrealized P/L
//     and marginal rate; 5-point handicap keeps the engine honest without
//     needing per-user tax data)
// Tax-advantaged detection uses BOTH accountType (canonical field) AND
// accountName as a fallback — older accounts sometimes have null type
// even though the name clearly says "TFSA" / "RRSP" / etc. Getting this
// wrong was surfacing "Taxable — 5-pt handicap applied" on registered
// accounts, penalizing a swap that had zero actual tax cost.
//
// Transaction cost adjustment: 1 point per side (2 total for a swap).
//
// Output shape:
//   {
//     opportunities: [
//       {
//         holding: { ticker, sleeve, account, cad_value, position_weight_pct,
//                    composite: {score, factors, contributors} },
//         challenger: { ticker, sleeve, currency, composite: {...},
//                       entryPrice, targetPrice, stopPrice },
//         deltaScore, sleeveHurdle, taxHandicap, transactionCost,
//         netAdvantage, recommendation: "UPSWITCH" | "KEEP" | "EXIT_TO_CASH",
//         rationale: string,
//       },
//       ...
//     ],
//     hurdles: { core, income, swing, spec },
//     summary: { heldScored, candidatesConsidered, upswitchCount, keepCount }
//   }

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { getFundamentals } from "./stocksFundamentals.js";
import { getGrowth, getEstimateRevisions } from "./stocksGrowthRevisions.js";
import { getRecentInsiderSignals } from "./stocksInsiderSignals.js";
import { computeMultiFactorScore, computeRelativeStrengthFromBars } from "./stocksMultiFactorScore.js";
import { getTechnicals } from "./stocksTechnicals.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";

// ─── Hurdles ──────────────────────────────────────────────────────────
export const UPSWITCH_HURDLES = { core: 40, income: 25, swing: 15, spec: 20 };
const TX_COST_POINTS = 1;   // per side; a swap = 2 total
const TAXABLE_HANDICAP = 5; // deducted when account is not tax-advantaged

// Broad tax classification. Anything registered in Canada is treated as
// tax-advantaged (no capital-gain event when selling). Individual /
// Corporate / Trust / Non-Spousal-Individual pay tax on realized gains.
const TAX_ADVANTAGED_TYPES = new Set([
  "rrsp", "spousal-rrsp", "spousalrrsp", "tfsa", "fhsa", "rrif", "lira", "lif", "resp",
]);
function isTaxAdvantaged(accountType, accountName = "") {
  // Primary check — canonical account_type from the schema.
  if (accountType && TAX_ADVANTAGED_TYPES.has(String(accountType).toLowerCase())) return true;
  // Fallback — pattern-match the human-readable account name. Real
  // portfolios in production have accounts whose `type` was never
  // populated (schema was extended later), but whose `name` clearly
  // says "TFSA" / "RRSP" / etc. Without this fallback the tax
  // handicap was being applied to registered accounts and penalizing
  // swaps that had no tax cost at all.
  const nm = String(accountName || "").toLowerCase();
  if (/\b(tfsa|rrsp|rrif|lira|lif|fhsa|resp)\b/.test(nm)) return true;
  if (/spousal[\s-]?rrsp/.test(nm)) return true;
  return false;
}

// Tolerance for challenger.entryPrice vs the challenger's independently
// fetched live price. 3% is loose enough to accommodate a briefing
// generated during premarket where the entry was captured against the
// prior close, but tight enough to catch the pathological case where
// the entry was populated with an unrelated ticker's price.
const CHALLENGER_PRICE_TOLERANCE_PCT = 3;

// Reject a challenger candidate whose entry / target / stop trio is
// impossible or degenerate. Real bug: AI-hallucinated recs where all
// three values are the same (typically copied from the incumbent's
// price). Also rejects: missing values, zero values, and BUYs where
// target <= entry or stop >= entry (which invert reward/risk).
function challengerLevelsValid(c) {
  const e = Number(c?.entryPrice);
  const t = Number(c?.targetPrice);
  const s = Number(c?.stopPrice);
  if (!Number.isFinite(e) || e <= 0) return { ok: false, reason: "entry-missing-or-zero" };
  if (!Number.isFinite(t) || t <= 0) return { ok: false, reason: "target-missing-or-zero" };
  if (!Number.isFinite(s) || s <= 0) return { ok: false, reason: "stop-missing-or-zero" };
  // All three equal is nonsense — zero upside, zero downside, undefined R/R.
  if (Math.abs(e - t) < 0.001 && Math.abs(e - s) < 0.001) return { ok: false, reason: "entry-target-stop-all-equal" };
  if (t <= e) return { ok: false, reason: "target-not-above-entry-for-buy" };
  if (s >= e) return { ok: false, reason: "stop-not-below-entry-for-buy" };
  // Minimum reward/risk: target-entry vs entry-stop must be >= 1.0
  // (permissive threshold; validator's ruleMinRewardRisk enforces
  // 1.5 downstream — this is a first-pass sanity check).
  const rr = (t - e) / Math.max(0.01, e - s);
  if (rr < 1.0) return { ok: false, reason: "reward-below-risk" };
  return { ok: true };
}

// Score one ticker with the full multi-factor composite. Reuses every
// existing service (technicals, fundamentals, growth, revisions, RS,
// insider) so a held position is measured with the identical yardstick
// as a candidate. Returns null when the ticker can't be scored (bars
// missing) — caller skips it.
async function scoreOneTicker(ticker, currency = "USD", insiderByBase = null, benchmarks = {}) {
  try {
    const tech = await getTechnicals(ticker, currency, { includeMultiTimeframe: true });
    if (!tech?.ok) return null;
    // Approximate the technical sub-score using the same 0-100 heuristic
    // scoreCandidate does. Cheaper than importing scoreCandidate to avoid
    // a circular import with stocksDailyPickEngine.
    const technicalScore = approxTechnicalScore(tech);

    const base = String(ticker).replace(/\..*$/, "");
    const bench = currency === "CAD" ? benchmarks.xic : benchmarks.spy;
    const [tickerBars, fundamentals, growth, revisions] = await Promise.all([
      fetchYahooDaily(ticker, "1y").catch(() => null),
      getFundamentals(ticker, currency).catch(() => null),
      getGrowth(ticker).catch(() => null),
      getEstimateRevisions(ticker).catch(() => null),
    ]);
    const rs = (tickerBars && bench)
      ? computeRelativeStrengthFromBars(tickerBars, bench)
      : { ok: false };
    const insider = insiderByBase ? (insiderByBase.get(base) || null) : null;

    const composite = computeMultiFactorScore({
      technicalScore, fundamentals, growth, revisions, rs, insider,
    });
    return {
      composite,
      technicalScore,
      currency,
      lastPrice: tech.last,
      atr14: tech.atr14,
      suggested25AtrStop: tech.suggested25AtrStop,
    };
  } catch { return null; }
}

// Local approximation of the technical bucket score. Kept in sync with
// the fields scoreCandidate looks at in stocksDailyPickEngine.js.
function approxTechnicalScore(tech) {
  if (!tech?.ok) return 0;
  let score = 0;
  if (tech.sma50 && tech.sma200 && tech.priceVsSma50 >= 0 && tech.sma50 > tech.sma200) score += 25;
  else if (tech.priceVsSma50 >= 0) score += 10;
  if (tech.rsi14 != null) {
    if (tech.rsi14 >= 50 && tech.rsi14 <= 65) score += 15;
    else if (tech.rsi14 >= 40 && tech.rsi14 < 50) score += 7;
    else if (tech.rsi14 > 65 && tech.rsi14 <= 75) score += 3;
    else if (tech.rsi14 > 75) score -= 30;
  }
  if (tech.volume?.rvol >= 1.5) score += 8;
  if (tech.volume?.pocketPivot) score += 10;
  if (tech.volume?.obvTrend === "accumulation") score += 4;
  const bullSetup = (tech.setups || []).find((s) => s.type === "bullish");
  if (bullSetup) score += Math.min(25, Math.round(bullSetup.score / 4));
  if (tech.mtf?.confluence === "aligned" && tech.mtf.direction === "up") score += 15;
  else if (tech.mtf?.confluence === "aligned" && tech.mtf.direction === "down") score -= 15;
  else if (tech.mtf?.confluence === "conflicting") score -= 5;
  if (tech.priceVsSma50 != null && tech.priceVsSma50 < -3) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Main entry. Requires an already-computed canonical portfolio + the
// candidate pool (top Stage-2 candidates from the pick engine, each
// carrying a composite score). Loads benchmark bars + a single batch
// of insider signals per this call so the per-ticker composites don't
// each hit the network separately.
export async function computeUpswitchOpportunities({ canonical, candidates = [] } = {}) {
  if (!canonical) return { opportunities: [], hurdles: UPSWITCH_HURDLES, summary: null };

  // Only consider held equity positions (skip cash-ETF proxies etc.).
  const held = (canonical.positions || []).filter(p => p.qty > 0 && p.cad_value > 0);
  if (held.length === 0) {
    return { opportunities: [], hurdles: UPSWITCH_HURDLES, summary: { heldScored: 0, candidatesConsidered: 0, upswitchCount: 0, keepCount: 0 } };
  }

  // Load benchmarks ONCE. Reused across every held-position + challenger
  // RS calc so we don't refetch 20+ times per briefing.
  const [spy, xic] = await Promise.all([
    fetchYahooDaily("SPY", "1y").catch(() => null),
    fetchYahooDaily("XIC.TO", "1y").catch(() => null),
  ]);
  const benchmarks = { spy, xic };

  // Insider batch — cover held + challenger tickers in one query.
  const heldBases = held.map(p => p.base);
  const challengerBases = candidates.map(c => String(c.ticker || "").replace(/\..*$/, ""));
  const insiderByBase = new Map();
  try {
    const signals = await getRecentInsiderSignals([...heldBases, ...challengerBases], { days: 30, limit: 90 });
    for (const s of signals || []) {
      const b = String(s.ticker || "").toUpperCase().replace(/\..*$/, "");
      const prev = insiderByBase.get(b) || { clusterBuy: false, clusterSell: false };
      if (s.kind === "cluster_buy") prev.clusterBuy = true;
      if (s.kind === "cluster_sell") prev.clusterSell = true;
      insiderByBase.set(b, prev);
    }
  } catch { /* no insider signals — factor stays neutral */ }

  // Score every held position with the same composite. Concurrency-
  // capped at 5 so a 20-position book doesn't melt the FMP quota.
  const scoredHeld = [];
  const CONC = 5;
  for (let i = 0; i < held.length; i += CONC) {
    const slice = held.slice(i, i + CONC);
    const results = await Promise.all(slice.map(async (pos) => {
      const s = await scoreOneTicker(pos.ticker, pos.currency, insiderByBase, benchmarks);
      if (!s) return null;
      return { holding: pos, ...s };
    }));
    for (const r of results) if (r) scoredHeld.push(r);
  }

  // Sort held from worst-scoring to best. The upswitch loop tries the
  // weakest first — that's where the biggest replacement wins live.
  scoredHeld.sort((a, b) => (a.composite.score ?? 0) - (b.composite.score ?? 0));

  // Sort candidates by composite descending (they should already carry
  // compositeRank from the pick engine; fall back to deterministicScore
  // if not present).
  const rankedCandidates = [...candidates].sort((a, b) =>
    (b.multiFactorScore ?? b.compositeRank ?? b.deterministicScore ?? 0) -
    (a.multiFactorScore ?? a.compositeRank ?? a.deterministicScore ?? 0)
  );

  const opportunities = [];
  const usedChallengers = new Set();   // one challenger per opportunity per briefing

  for (const holdRow of scoredHeld) {
    const pos = holdRow.holding;
    const posSleeve = (pos.sleeve || classifyPosition({ ticker: pos.ticker }) || "spec").toLowerCase();
    // Tax handicap — challenger's advantage takes a 5-point hit when
    // the sell would realize a capital gain in a taxable account.
    // Registered accounts (TFSA/RRSP/etc.) get 0 handicap. Uses BOTH
    // account_type and account_name so accounts missing the newer
    // `type` field still classify correctly.
    const taxAdvantaged = isTaxAdvantaged(pos.account_type, pos.account_name);
    const taxHandicap = taxAdvantaged ? 0 : TAXABLE_HANDICAP;

    // Preferred pool: same-currency challengers not already earmarked.
    // Fall back to any-currency if same-currency pool is empty.
    const sameCcy = rankedCandidates.filter(c =>
      !usedChallengers.has(String(c.ticker || "").toUpperCase()) &&
      (c.currency || "USD") === (pos.currency || "USD")
    );
    const pool = sameCcy.length > 0 ? sameCcy : rankedCandidates.filter(c => !usedChallengers.has(String(c.ticker || "").toUpperCase()));

    // Never suggest swapping to a ticker we already hold — that's not
    // an upswitch, it's a stack.
    const heldSet = new Set(held.map(h => h.base));
    const eligible = pool.filter(c => !heldSet.has(String(c.ticker || "").replace(/\..*$/, "")));

    if (eligible.length === 0) continue;

    // Best challenger for this incumbent.
    const challenger = eligible[0];
    const challengerScore = challenger.multiFactorScore ?? challenger.compositeRank ?? challenger.deterministicScore ?? 0;
    const heldScore = holdRow.composite.score ?? 0;
    const deltaScore = challengerScore - heldScore;
    // Hurdle by CHALLENGER's own sleeve — inheriting the incumbent
    // sleeve's hurdle produced nonsense pairings (e.g. TD INCOME →
    // SSRM mining challenger scored against INCOME hurdle). The
    // relevant question is "does the challenger's sleeve context
    // justify a swap given its own risk profile?" — use its own
    // classification.
    const challengerSleeve = (classifyPosition({ ticker: challenger.ticker }) || "spec").toLowerCase();
    const hurdle = UPSWITCH_HURDLES[challengerSleeve] ?? UPSWITCH_HURDLES.swing;
    const sleeveRotation = challengerSleeve !== posSleeve;
    const totalCost = (TX_COST_POINTS * 2) + taxHandicap;
    const netAdvantage = deltaScore - totalCost;

    // Independent price verification — fetch the challenger's OWN
    // technicals and compare the incoming entryPrice to the live
    // last price. If they diverge beyond tolerance, the entry is
    // suspect (cross-ticker contamination, stale rec, or hallucinated
    // level) and the upswitch cannot be trusted. This runs BEFORE
    // level-shape validation so a price mismatch takes precedence
    // over other issues.
    let priceVerifyReason = null;
    try {
      const cTech = await getTechnicals(challenger.ticker, challenger.currency || "USD", { includeMultiTimeframe: false });
      const livePrice = Number(cTech?.last);
      const incomingEntry = Number(challenger.entryPrice);
      if (!Number.isFinite(livePrice) || livePrice <= 0) {
        priceVerifyReason = "live-price-unavailable";
      } else if (Number.isFinite(incomingEntry) && incomingEntry > 0) {
        const driftPct = Math.abs(livePrice - incomingEntry) / livePrice * 100;
        if (driftPct > CHALLENGER_PRICE_TOLERANCE_PCT) {
          priceVerifyReason = `entry-price-off-market (rec entry $${incomingEntry.toFixed(2)} vs live $${livePrice.toFixed(2)}, ${driftPct.toFixed(1)}% drift, tolerance ${CHALLENGER_PRICE_TOLERANCE_PCT}%)`;
        }
      }
    } catch { priceVerifyReason = "live-price-fetch-failed"; }

    // Reject challengers with degenerate entry/target/stop. Real bug:
    // AI-hallucinated recs where all three were the incumbent's price.
    const levels = challengerLevelsValid(challenger);

    let recommendation;
    let rationale;
    if (priceVerifyReason) {
      // Live-price verify failed BEFORE any level-shape check —
      // means the challenger's entry price does not agree with its
      // own live market price. Root cause is usually cross-ticker
      // contamination (a rec picked up an unrelated ticker's price).
      // Cannot trust ANY of the challenger's numbers, so downgrade.
      recommendation = "SCREENED";
      rationale = `${challenger.ticker} rejected by live-price verification: ${priceVerifyReason}. Score Δ+${deltaScore} vs ${pos.ticker} is not actionable until the rec is regenerated from clean data.`;
    } else if (!levels.ok) {
      // Score cleared the hurdle but the trade itself doesn't pass
      // basic entry/target/stop sanity. Downgrade to SCREENED so the
      // operator sees the engine found something but couldn't
      // actually build a valid order.
      recommendation = "SCREENED";
      rationale = `${challenger.ticker} composite ${challengerScore} vs ${pos.ticker} ${heldScore} (Δ+${deltaScore}) would clear the hurdle, but the challenger's entry/target/stop failed a basic sanity check: ${levels.reason}. No actionable swap. Investigate the challenger's rec source (likely AI-hallucinated levels).`;
    } else if (netAdvantage >= hurdle) {
      recommendation = "UPSWITCH";
      const rotationNote = sleeveRotation ? ` NOTE: sleeve rotation (incumbent=${posSleeve}, challenger=${challengerSleeve}) — this changes portfolio sleeve mix.` : "";
      rationale = `${challenger.ticker} composite ${challengerScore} vs ${pos.ticker} ${heldScore} (Δ+${deltaScore}). ${taxAdvantaged ? "Tax-advantaged account — no capital-gain drag." : `Taxable — ${TAXABLE_HANDICAP}-pt handicap applied.`} Challenger sleeve="${challengerSleeve}" hurdle +${hurdle}. Net advantage +${netAdvantage.toFixed(0)} clears the hurdle.${rotationNote}`;
      usedChallengers.add(String(challenger.ticker || "").toUpperCase());
    } else if (heldScore < 35 && deltaScore < hurdle) {
      // Weakness without a good replacement — flag EXIT_TO_CASH so the
      // operator has the option to raise cash rather than force a
      // marginal swap. Only for really weak holdings (score < 35) —
      // don't nudge exits on average names just because no challenger
      // was strong enough.
      recommendation = "EXIT_TO_CASH";
      rationale = `${pos.ticker} composite ${heldScore} is weak (<35) but no challenger cleared the +${hurdle} hurdle. Consider exit-to-cash instead of forcing a swap; redeploy when a real challenger appears.`;
    } else {
      recommendation = "KEEP";
      rationale = `Best challenger ${challenger.ticker} at ${challengerScore} vs ${pos.ticker} ${heldScore} → net advantage +${netAdvantage.toFixed(0)} < +${hurdle} sleeve hurdle. HOLD ${pos.ticker}.`;
    }

    opportunities.push({
      holding: {
        ticker: pos.ticker,
        base: pos.base,
        sleeve: posSleeve,
        account: pos.account_name,
        accountType: pos.account_type,
        cad_value: pos.cad_value,
        position_weight_pct: pos.position_weight_pct,
        composite: holdRow.composite,
      },
      challenger: {
        ticker: challenger.ticker,
        sleeve: challenger.sleeve || null,
        currency: challenger.currency || "USD",
        composite: { score: challengerScore, factors: challenger.factorBreakdown, contributors: challenger.multiFactorContributors },
        entryPrice: challenger.entryPrice ?? null,
        targetPrice: challenger.targetPrice ?? null,
        stopPrice: challenger.stopPrice ?? null,
      },
      deltaScore,
      sleeveHurdle: hurdle,
      taxHandicap,
      transactionCost: TX_COST_POINTS * 2,
      netAdvantage: Number(netAdvantage.toFixed(1)),
      recommendation,
      rationale,
    });
  }

  // Show UPSWITCH first, then SCREENED (would-clear-but-invalid),
  // then EXIT_TO_CASH, then KEEP. Within each group, sort by
  // netAdvantage desc so the biggest opportunity leads.
  const rank = { UPSWITCH: 0, SCREENED: 1, EXIT_TO_CASH: 2, KEEP: 3 };
  opportunities.sort((a, b) => (rank[a.recommendation] - rank[b.recommendation]) || (b.netAdvantage - a.netAdvantage));

  const summary = {
    heldScored: scoredHeld.length,
    candidatesConsidered: rankedCandidates.length,
    upswitchCount: opportunities.filter(o => o.recommendation === "UPSWITCH").length,
    screenedCount: opportunities.filter(o => o.recommendation === "SCREENED").length,
    exitToCashCount: opportunities.filter(o => o.recommendation === "EXIT_TO_CASH").length,
    keepCount: opportunities.filter(o => o.recommendation === "KEEP").length,
  };

  return { opportunities, hurdles: UPSWITCH_HURDLES, summary };
}

// Formatter for briefing injection — emits the §1b PORTFOLIO UPGRADE
// OPPORTUNITIES block. When no UPSWITCH recommendations survive, prints
// an explicit "NONE — no challenger cleared the sleeve hurdle" line so
// the briefing proves the engine actually looked, rather than silently
// omitting the section.
export function formatUpswitchBlock(result) {
  if (!result || !Array.isArray(result.opportunities)) return "";
  const upswitches = result.opportunities.filter(o => o.recommendation === "UPSWITCH");
  const screened   = result.opportunities.filter(o => o.recommendation === "SCREENED");
  const exitToCash = result.opportunities.filter(o => o.recommendation === "EXIT_TO_CASH");

  const lines = ["", "## 1b. 🔄 PORTFOLIO UPGRADE OPPORTUNITIES", ""];

  if (upswitches.length === 0 && screened.length === 0 && exitToCash.length === 0) {
    lines.push(`_Actionable upgrades: NONE — no challenger cleared the sleeve replacement hurdle (SWING +${result.hurdles.swing} · SPEC +${result.hurdles.spec} · INCOME +${result.hurdles.income} · CORE +${result.hurdles.core}). ${result.summary?.heldScored ?? 0} holdings scored vs ${result.summary?.candidatesConsidered ?? 0} candidates._`);
    return lines.join("\n");
  }

  if (upswitches.length === 0) {
    lines.push(`_Actionable upgrades: NONE._`);
    lines.push("");
  }

  for (const o of upswitches) {
    lines.push(`**UPSWITCH CANDIDATE** — TRIM/SELL **${o.holding.ticker}** (${o.holding.sleeve.toUpperCase()}, ${o.holding.account || "?"}) → BUY **${o.challenger.ticker}**`);
    lines.push(`   Composite: ${o.holding.ticker} ${o.holding.composite?.score ?? "?"} → ${o.challenger.ticker} ${o.challenger.composite?.score ?? "?"} (Δ +${o.deltaScore})`);
    lines.push(`   Sleeve hurdle: +${o.sleeveHurdle} · Tax handicap: ${o.taxHandicap} · Transaction cost: ${o.transactionCost} · **Net advantage: +${o.netAdvantage.toFixed(0)}**`);
    lines.push(`   ${o.rationale}`);
    if (o.challenger.entryPrice) {
      lines.push(`   Challenger levels: entry $${o.challenger.entryPrice.toFixed(2)}${o.challenger.targetPrice ? ` / target $${o.challenger.targetPrice.toFixed(2)}` : ""}${o.challenger.stopPrice ? ` / stop $${o.challenger.stopPrice.toFixed(2)}` : ""} ${o.challenger.currency}`);
    }
    lines.push("");
  }
  // SCREENED — cleared score hurdle but the trade itself is not
  // actionable (invalid levels, negative reward/risk, etc.).
  // Deduplicate by challenger ticker: the same challenger will beat
  // many incumbents on score but its own levels are still what they
  // are, so listing "AC.TO vs DJT ... AC.TO vs TD ... AC.TO vs BNS"
  // 13 times just spams the reader. Emit ONE line per challenger
  // with the reason + the incumbents it outranked.
  if (screened.length > 0) {
    const byChallenger = new Map();
    for (const o of screened) {
      const ct = String(o.challenger.ticker || "").toUpperCase();
      if (!byChallenger.has(ct)) {
        byChallenger.set(ct, {
          challenger: o.challenger.ticker,
          challengerScore: o.challenger.composite?.score ?? "?",
          reason: null,
          incumbents: [],
        });
      }
      const entry = byChallenger.get(ct);
      entry.incumbents.push(`${o.holding.ticker} (${o.holding.composite?.score ?? "?"})`);
      // Extract the reason once from the first rationale that has it.
      if (!entry.reason) {
        const rm = /failed a basic sanity check:\s*([^.]+)/i.exec(o.rationale || "")
                || /rejected by live-price verification:\s*([^.]+)/i.exec(o.rationale || "");
        entry.reason = rm ? rm[1].trim() : "entry/risk gates failed";
      }
    }
    const challengersList = [...byChallenger.values()].map(e => e.challenger).join(", ");
    lines.push(`**UPSWITCH SCREENED — NO ACTION**: higher-scoring challengers rejected: ${challengersList} — entry/risk gates failed. No actionable swap for these pairings.`);
    for (const e of byChallenger.values()) {
      lines.push(`   ${e.challenger} (composite ${e.challengerScore}) outranked ${e.incumbents.length} incumbent${e.incumbents.length === 1 ? "" : "s"} (${e.incumbents.join(", ")}) but was rejected: ${e.reason}.`);
    }
    lines.push("");
  }
  for (const o of exitToCash) {
    lines.push(`**EXIT-TO-CASH CANDIDATE** — **${o.holding.ticker}** (${o.holding.sleeve.toUpperCase()}, composite ${o.holding.composite?.score ?? "?"})`);
    lines.push(`   ${o.rationale}`);
    lines.push("");
  }
  return lines.join("\n");
}
