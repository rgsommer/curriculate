// backend/services/stocksP4NominationLanes.js
//
// P4 (2026-09-11) — parallel candidate nomination.
//
// Each lane independently proposes candidates from cheap signals so
// no single ranking (typically technical) gets to decide the entire
// universe. The union feeds Stage-2 scoring.
//
// Lanes:
//   TECHNICAL         — top-N by combined technical rank (existing)
//   REVISION          — biggest positive real-EPS/revenue revisions
//   QUALITY_GROWTH    — quality (FCF/ROE/D/E) × growth accel
//   RELATIVE_STRENGTH — top-N by 3m/6m RS vs matched benchmark
//   INDUSTRY_LEADER   — top-quartile industry, leader within it
//   POST_EARNINGS     — recent positive surprise with drift
//   CATALYST          — material catalyst rows
//
// Every nomination carries { ticker, lane, laneRank, reasonNominated }.
// Downstream code unions by ticker and joins the lane list.

import { P4_NOMINATION_LANES } from "./stocksScoringModels.js";

function baseTicker(t) { return String(t || "").toUpperCase(); }

// PUBLIC — union nominations from all lanes.
// Input: perLane = { TECHNICAL: [{ticker, rank, reason}], … }
// Output: [{ ticker, lanes: [...], laneRanks: {LANE: rank}, reasons: [...] }]
export function unionNominations(perLane) {
  const byTicker = new Map();
  for (const lane of P4_NOMINATION_LANES) {
    const entries = perLane[lane] || [];
    entries.forEach((e, i) => {
      const t = baseTicker(e.ticker);
      if (!t) return;
      if (!byTicker.has(t)) byTicker.set(t, { ticker: t, lanes: [], laneRanks: {}, reasons: [] });
      const row = byTicker.get(t);
      if (!row.lanes.includes(lane)) row.lanes.push(lane);
      row.laneRanks[lane] = Number.isFinite(e.rank) ? e.rank : (i + 1);
      if (e.reason) row.reasons.push(`${lane}: ${e.reason}`);
    });
  }
  const rows = [...byTicker.values()];
  // Order by number of lanes nominating (multi-lane confirmations
  // first), tiebreak by best rank across lanes.
  rows.sort((a, b) => {
    if (b.lanes.length !== a.lanes.length) return b.lanes.length - a.lanes.length;
    const bestA = Math.min(...Object.values(a.laneRanks));
    const bestB = Math.min(...Object.values(b.laneRanks));
    return bestA - bestB;
  });
  return rows.map((r, i) => ({ ...r, unionRank: i + 1 }));
}

// PUBLIC — cheap helpers each lane can call. These are DELIBERATELY
// simple projections; the whole point of parallel lanes is to catch
// candidates the technical rank misses, not to duplicate Stage-2
// scoring. Each helper reads whatever pre-computed candidate array
// the caller supplies (from the existing discovery pool).

// TECHNICAL — top-N by technical combined score / rank.
export function nominateTechnical(candidates, { topN = 30 } = {}) {
  return [...candidates]
    .filter(c => Number.isFinite(c.techRank) || Number.isFinite(c.combinedScore))
    .sort((a, b) => (a.techRank ?? -a.combinedScore) - (b.techRank ?? -b.combinedScore))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1, reason: `tech rank ${i + 1}` }));
}

// REVISION — biggest positive real-EPS revisions (past 30d).
export function nominateRevision(candidates, { topN = 20, minPositivePct = 3 } = {}) {
  return [...candidates]
    .filter(c => Number.isFinite(c.epsRevisionPct) && c.epsRevisionPct >= minPositivePct)
    .sort((a, b) => (b.epsRevisionPct || 0) - (a.epsRevisionPct || 0))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1, reason: `EPS revision ${c.epsRevisionPct.toFixed(1)}%` }));
}

// QUALITY_GROWTH — high fundamentals score AND growth accelerating.
export function nominateQualityGrowth(candidates, { topN = 20, minFundamentals = 70, minGrowthAccelPct = 0 } = {}) {
  return [...candidates]
    .filter(c => (c.fundamentalsScore ?? 0) >= minFundamentals &&
                 (c.growthAccelPct ?? -Infinity) >= minGrowthAccelPct)
    .sort((a, b) => (b.fundamentalsScore + b.growthAccelPct) - (a.fundamentalsScore + a.growthAccelPct))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1,
      reason: `fundamentals ${c.fundamentalsScore}, growth accel ${c.growthAccelPct?.toFixed(1)}%` }));
}

// RELATIVE_STRENGTH — top-N by 3m/6m RS vs matched benchmark.
export function nominateRelativeStrength(candidates, { topN = 20, minRsPct = 5 } = {}) {
  return [...candidates]
    .filter(c => Number.isFinite(c.rs3mPct) && c.rs3mPct >= minRsPct)
    .sort((a, b) => (b.rs3mPct || 0) - (a.rs3mPct || 0))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1, reason: `RS 3m ${c.rs3mPct.toFixed(1)}% vs bench` }));
}

// INDUSTRY_LEADER — top-quartile industry group + leader within it.
export function nominateIndustryLeader(candidates, { topN = 20, minIndustryStrength = 75 } = {}) {
  return [...candidates]
    .filter(c => (c.industryStrength ?? 0) >= minIndustryStrength)
    .sort((a, b) => (b.industryStrength || 0) - (a.industryStrength || 0))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1,
      reason: `industry strength ${c.industryStrength} (${c.industry || "?"})` }));
}

// POST_EARNINGS — recent positive surprise + drift.
export function nominatePostEarnings(candidates, { topN = 20 } = {}) {
  return [...candidates]
    .filter(c => (c.earningsSurprisePct ?? -Infinity) > 5 && (c.postEarningsDriftPct ?? -Infinity) > 0)
    .sort((a, b) => (b.postEarningsDriftPct || 0) - (a.postEarningsDriftPct || 0))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1,
      reason: `surprise +${c.earningsSurprisePct}%, drift +${c.postEarningsDriftPct}%` }));
}

// CATALYST — material catalyst rows (M&A, FDA, contract wins).
export function nominateCatalyst(candidates, { topN = 20 } = {}) {
  return [...candidates]
    .filter(c => (c.catalystScore ?? 0) >= 70 && c.catalystType && c.catalystType !== "SENTIMENT")
    .sort((a, b) => (b.catalystScore || 0) - (a.catalystScore || 0))
    .slice(0, topN)
    .map((c, i) => ({ ticker: c.ticker, rank: i + 1,
      reason: `${c.catalystType} catalyst score ${c.catalystScore}` }));
}

// PUBLIC — run all lanes over a shared candidate universe and union.
export function runAllLanes(candidates, overrides = {}) {
  const perLane = {
    TECHNICAL: nominateTechnical(candidates, overrides.TECHNICAL),
    REVISION: nominateRevision(candidates, overrides.REVISION),
    QUALITY_GROWTH: nominateQualityGrowth(candidates, overrides.QUALITY_GROWTH),
    RELATIVE_STRENGTH: nominateRelativeStrength(candidates, overrides.RELATIVE_STRENGTH),
    INDUSTRY_LEADER: nominateIndustryLeader(candidates, overrides.INDUSTRY_LEADER),
    POST_EARNINGS: nominatePostEarnings(candidates, overrides.POST_EARNINGS),
    CATALYST: nominateCatalyst(candidates, overrides.CATALYST),
  };
  return { perLane, union: unionNominations(perLane) };
}
