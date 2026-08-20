// backend/services/stocksMultiFactorScore.js
//
// Phase-2 audit fix #1: composite quantitative rank that integrates
// technicals + fundamentals + estimate revisions + relative strength
// + insider signals into a single 0-100 score.
//
// The old scoreCandidate in stocksDailyPickEngine.js only used OHLC-
// derived technicals (trend/RSI/RVOL/setup/MTF). Per audit feedback:
//   "It still isn't the multi-factor alpha engine I had in mind. The
//    daily picker doesn't rank explicitly on earnings revisions,
//    earnings acceleration, revenue acceleration, FCF improvement,
//    valuation relative to growth, insider buying, analyst revisions,
//    forward estimate dispersion, institutional accumulation, sector
//    relative strength, or fundamental quality."
//
// Composite (0-100):
//   Technical         40  (reuses scoreCandidate — the existing engine)
//   Fundamentals      15  (FCF yield, ROE, debt/equity, valuation vs growth)
//   Growth            15  (revenue acceleration, EPS acceleration)
//   Estimate revisions 10 (EPS-estimate 4-week change proxy)
//   Relative strength 15  (1M+3M+6M vs SPY/XIC benchmark)
//   Insider           5  (recent cluster buys)
//
// Every factor bucket returns a 0-1 normalized sub-score plus a set of
// contributor strings for auditability. Composite = weighted sum × 100.
//
// This is DETERMINISTIC. No LLM in the loop. Same inputs → same score.

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

// ─── Weights ─────────────────────────────────────────────────────────
export const FACTOR_WEIGHTS = {
  technical: 0.40,
  fundamentals: 0.15,
  growth: 0.15,
  estimate_revisions: 0.10,
  relative_strength: 0.15,
  insider: 0.05,
};

// ─── Individual factor scorers ───────────────────────────────────────
// Each returns { score: 0..1, contributors: string[] }.

// Fundamentals — FCF yield + ROE + debt discipline + PE-vs-growth.
export function scoreFundamentals(fundamentals) {
  const c = [];
  if (!fundamentals?.ok) return { score: 0.5, contributors: ["fundamentals unavailable — neutral"] };
  let sub = 0;
  let denom = 0;

  // FCF yield: >6% = full point; <2% = zero
  if (Number.isFinite(fundamentals.fcfYieldPct)) {
    const fy = fundamentals.fcfYieldPct;
    const pt = fy >= 6 ? 1 : fy >= 4 ? 0.75 : fy >= 2 ? 0.4 : 0;
    sub += pt; denom += 1;
    c.push(`FCF yield ${fy.toFixed(1)}% → ${pt.toFixed(2)}`);
  }

  // ROE: >15% = strong
  if (Number.isFinite(fundamentals.roeTTM)) {
    const roe = fundamentals.roeTTM;
    const pt = roe >= 20 ? 1 : roe >= 15 ? 0.75 : roe >= 10 ? 0.5 : roe >= 5 ? 0.25 : 0;
    sub += pt; denom += 1;
    c.push(`ROE ${roe.toFixed(1)}% → ${pt.toFixed(2)}`);
  }

  // Debt discipline: D/E < 1.0 = clean; 1-2 = OK; >2 = leveraged
  if (Number.isFinite(fundamentals.debtToEquity)) {
    const de = fundamentals.debtToEquity;
    const pt = de <= 1 ? 1 : de <= 2 ? 0.6 : de <= 3 ? 0.3 : 0;
    sub += pt; denom += 1;
    c.push(`D/E ${de.toFixed(2)} → ${pt.toFixed(2)}`);
  }

  // PEG-lite: PE vs implied growth. peRatio / (revGrowth+earnGrowth)/2.
  // Not always available; skip when missing.
  if (Number.isFinite(fundamentals.peRatio) && fundamentals.peRatio > 0 && Number.isFinite(fundamentals.roeTTM)) {
    // Rough proxy: PE/ROE — lower = cheaper for the profitability.
    const peRoe = fundamentals.peRatio / Math.max(1, fundamentals.roeTTM);
    const pt = peRoe <= 1 ? 1 : peRoe <= 1.5 ? 0.7 : peRoe <= 2 ? 0.4 : peRoe <= 3 ? 0.2 : 0;
    sub += pt; denom += 1;
    c.push(`PE/ROE ${peRoe.toFixed(2)} → ${pt.toFixed(2)}`);
  }

  return denom > 0
    ? { score: sub / denom, contributors: c }
    : { score: 0.5, contributors: [...c, "no scorable fundamental fields — neutral"] };
}

// Growth — revenue + EPS acceleration YoY (latest quarter vs YoY quarter).
// Requires FMP income-statement quarterly data. Neutral (0.5) if not
// provided so we don't over-punish stocks we can't measure.
export function scoreGrowth(growth) {
  const c = [];
  if (!growth?.ok) return { score: 0.5, contributors: ["growth data unavailable — neutral"] };
  let sub = 0;
  let denom = 0;

  // Revenue YoY growth
  if (Number.isFinite(growth.revenueYoYPct)) {
    const g = growth.revenueYoYPct;
    const pt = g >= 25 ? 1 : g >= 15 ? 0.75 : g >= 8 ? 0.5 : g >= 3 ? 0.3 : g >= 0 ? 0.15 : 0;
    sub += pt; denom += 1;
    c.push(`revenue YoY ${g >= 0 ? "+" : ""}${g.toFixed(1)}% → ${pt.toFixed(2)}`);
  }

  // Revenue acceleration (this Q growth − last Q growth, both YoY)
  if (Number.isFinite(growth.revenueAccelPp)) {
    const a = growth.revenueAccelPp;
    const pt = a >= 3 ? 1 : a >= 1 ? 0.75 : a >= 0 ? 0.5 : a >= -2 ? 0.3 : 0;
    sub += pt; denom += 1;
    c.push(`revenue accel ${a >= 0 ? "+" : ""}${a.toFixed(1)}pp → ${pt.toFixed(2)}`);
  }

  // EPS YoY growth
  if (Number.isFinite(growth.epsYoYPct)) {
    const g = growth.epsYoYPct;
    const pt = g >= 30 ? 1 : g >= 15 ? 0.75 : g >= 8 ? 0.5 : g >= 0 ? 0.3 : 0;
    sub += pt; denom += 1;
    c.push(`EPS YoY ${g >= 0 ? "+" : ""}${g.toFixed(1)}% → ${pt.toFixed(2)}`);
  }

  return denom > 0
    ? { score: sub / denom, contributors: c }
    : { score: 0.5, contributors: [...c, "no growth fields — neutral"] };
}

// Estimate revisions — 4-week change in consensus forward EPS.
// Positive = analysts revising higher; negative = revising lower.
export function scoreEstimateRevisions(revisions) {
  if (!revisions || !Number.isFinite(revisions.epsRev4wPct)) {
    return { score: 0.5, contributors: ["estimate revisions unavailable — neutral"] };
  }
  const r = revisions.epsRev4wPct;
  const pt = r >= 5 ? 1 : r >= 2 ? 0.85 : r >= 0.5 ? 0.65 : r >= 0 ? 0.5 : r >= -2 ? 0.3 : r >= -5 ? 0.15 : 0;
  return { score: pt, contributors: [`EPS estimate 4w ${r >= 0 ? "+" : ""}${r.toFixed(2)}% → ${pt.toFixed(2)}`] };
}

// Relative strength — ticker's 1M/3M/6M return vs benchmark.
// Requires the ticker's daily closes and the benchmark's daily closes.
// Benchmark is SPY for USD, XIC.TO for CAD (chosen by caller).
export function scoreRelativeStrength(rsInput) {
  if (!rsInput?.ok) return { score: 0.5, contributors: ["RS data unavailable — neutral"] };
  const { rs1mPp, rs3mPp, rs6mPp } = rsInput;
  const c = [];
  let sub = 0;
  let denom = 0;

  for (const [name, val] of [["1M", rs1mPp], ["3M", rs3mPp], ["6M", rs6mPp]]) {
    if (Number.isFinite(val)) {
      const pt = val >= 10 ? 1 : val >= 5 ? 0.8 : val >= 2 ? 0.6 : val >= 0 ? 0.5 : val >= -3 ? 0.3 : val >= -8 ? 0.15 : 0;
      sub += pt; denom += 1;
      c.push(`RS ${name} ${val >= 0 ? "+" : ""}${val.toFixed(1)}pp vs bench → ${pt.toFixed(2)}`);
    }
  }
  return denom > 0
    ? { score: sub / denom, contributors: c }
    : { score: 0.5, contributors: ["no RS windows — neutral"] };
}

// Insider — recent cluster buy signal. Boolean input from insider-
// signals service; if signal exists this factor gets a bump.
export function scoreInsider(insider) {
  if (!insider) return { score: 0.5, contributors: ["no insider signal — neutral"] };
  if (insider.clusterBuy) return { score: 1, contributors: ["insider cluster BUY detected"] };
  if (insider.clusterSell) return { score: 0, contributors: ["insider cluster SELL detected"] };
  return { score: 0.5, contributors: ["insider activity mixed — neutral"] };
}

// Technical — thin wrapper that normalizes scoreCandidate's 0-100
// output into a 0-1 bucket. If the caller doesn't pass a technical
// score (unusual), returns neutral 0.5.
export function scoreTechnical(techScore) {
  if (!Number.isFinite(techScore)) return { score: 0.5, contributors: ["technical score not supplied — neutral"] };
  return { score: Math.max(0, Math.min(1, techScore / 100)), contributors: [`technical ${techScore}/100`] };
}

// ─── Compute relative strength from daily bars ───────────────────────
// Given ticker daily bars + benchmark daily bars, compute the ticker's
// return minus benchmark's return over the last N calendar days.
// Returns { ok, rs1mPp, rs3mPp, rs6mPp }.
export function computeRelativeStrengthFromBars(tickerBars, benchBars) {
  if (!Array.isArray(tickerBars) || tickerBars.length < 130) return { ok: false };
  if (!Array.isArray(benchBars) || benchBars.length < 130) return { ok: false };
  const tLast = tickerBars[tickerBars.length - 1]?.close;
  const bLast = benchBars[benchBars.length - 1]?.close;
  if (!Number.isFinite(tLast) || !Number.isFinite(bLast)) return { ok: false };

  const returnOver = (bars, back) => {
    const idx = Math.max(0, bars.length - back);
    const then = bars[idx]?.close;
    if (!Number.isFinite(then) || then <= 0) return null;
    return ((bars[bars.length - 1].close - then) / then) * 100;
  };

  const compute = (back) => {
    const t = returnOver(tickerBars, back);
    const b = returnOver(benchBars, back);
    return (Number.isFinite(t) && Number.isFinite(b)) ? t - b : null;
  };

  return {
    ok: true,
    rs1mPp: compute(21),   // ~1 month of trading days
    rs3mPp: compute(63),   // ~3 months
    rs6mPp: compute(126),  // ~6 months
  };
}

// ─── Composite ────────────────────────────────────────────────────────
// Input: { technicalScore, fundamentals, growth, revisions, rs, insider }
// Every input except technicalScore is optional; missing factors get
// their neutral 0.5 sub-score so a partially-informed stock isn't
// permanently ranked below a fully-informed one just because we don't
// have all the data yet.
export function computeMultiFactorScore(input) {
  const tech = scoreTechnical(input?.technicalScore);
  const fund = scoreFundamentals(input?.fundamentals);
  const grow = scoreGrowth(input?.growth);
  const rev = scoreEstimateRevisions(input?.revisions);
  const rs = scoreRelativeStrength(input?.rs);
  const ins = scoreInsider(input?.insider);

  const composite =
    tech.score * FACTOR_WEIGHTS.technical +
    fund.score * FACTOR_WEIGHTS.fundamentals +
    grow.score * FACTOR_WEIGHTS.growth +
    rev.score * FACTOR_WEIGHTS.estimate_revisions +
    rs.score * FACTOR_WEIGHTS.relative_strength +
    ins.score * FACTOR_WEIGHTS.insider;

  return {
    score: Math.round(composite * 100),  // 0-100
    factors: {
      technical: tech,
      fundamentals: fund,
      growth: grow,
      estimate_revisions: rev,
      relative_strength: rs,
      insider: ins,
    },
    weights: FACTOR_WEIGHTS,
    contributors: [
      ...tech.contributors.map(s => `[T×${FACTOR_WEIGHTS.technical}] ${s}`),
      ...fund.contributors.map(s => `[F×${FACTOR_WEIGHTS.fundamentals}] ${s}`),
      ...grow.contributors.map(s => `[G×${FACTOR_WEIGHTS.growth}] ${s}`),
      ...rev.contributors.map(s => `[R×${FACTOR_WEIGHTS.estimate_revisions}] ${s}`),
      ...rs.contributors.map(s => `[RS×${FACTOR_WEIGHTS.relative_strength}] ${s}`),
      ...ins.contributors.map(s => `[I×${FACTOR_WEIGHTS.insider}] ${s}`),
    ],
  };
}
