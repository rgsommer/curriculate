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

  // Revenue YoY growth — log-scaled continuous curve (audit Aug-28).
  // Prior version saturated at ≥25% → 1.0, making a 100%-YoY grower
  // indistinguishable from a 25%-YoY grower in the composite. The new
  // curve rewards hypergrowth explicitly: a 100%-grower now scores 1.2
  // and a 200%-grower 1.4, uncapped. Negative growth still 0.
  // Uses log-normalization so returns don't blow up on extreme inputs
  // and 25% = 1.0 remains a reference "healthy" threshold.
  if (Number.isFinite(growth.revenueYoYPct)) {
    const g = growth.revenueYoYPct;
    let pt;
    if (g <= 0) pt = 0;
    else if (g <= 25) pt = 0.15 + (g / 25) * 0.85; // linear 0→1 across 0-25%
    else pt = 1.0 + Math.log10(g / 25) * 0.4;       // log-scaled >25%: 50%=1.12, 100%=1.24, 200%=1.36
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

  // EPS YoY growth — log-scaled continuous (audit Aug-28). Same problem
  // as revenue: prior saturation at 30% hid the difference between a
  // 30% grower and a 200% earnings-inflection name. Reference threshold
  // 30% = 1.0.
  if (Number.isFinite(growth.epsYoYPct)) {
    const g = growth.epsYoYPct;
    let pt;
    if (g <= 0) pt = 0;
    else if (g <= 30) pt = 0.3 + (g / 30) * 0.7;
    else pt = 1.0 + Math.log10(g / 30) * 0.4;
    sub += pt; denom += 1;
    c.push(`EPS YoY ${g >= 0 ? "+" : ""}${g.toFixed(1)}% → ${pt.toFixed(2)}`);
  }

  // ── Tier 2.2 change-detection signals (audit Aug-28) ─────────────
  // These are 2nd-derivatives that identify inflection points BEFORE
  // they show up in absolute-level factor scores. Each contributes as
  // an independent factor when the underlying data exists.

  // EPS acceleration — Q0 YoY minus Q1 YoY. Positive = growth rate is
  // improving quarter-over-quarter (earnings-inflection signal).
  // Reference: +5pp = strong (1.0), 0 = neutral (0.5), −5pp = 0.
  if (Number.isFinite(growth.epsAccelPp)) {
    const a = growth.epsAccelPp;
    let pt;
    if (a >= 5) pt = 1;
    else if (a >= 0) pt = 0.5 + (a / 5) * 0.5;
    else if (a >= -5) pt = 0.5 + (a / 5) * 0.5;   // symmetric slope
    else pt = 0;
    sub += pt; denom += 1;
    c.push(`EPS accel ${a >= 0 ? "+" : ""}${a.toFixed(1)}pp → ${pt.toFixed(2)}`);
  }

  // Gross margin expansion (pp) — same-quarter year-ago. Positive =
  // pricing power / operating leverage improving. +2pp = 1.0 threshold.
  if (Number.isFinite(growth.grossMarginExpansionPp)) {
    const m = growth.grossMarginExpansionPp;
    let pt;
    if (m >= 2) pt = 1;
    else if (m >= 0) pt = 0.5 + (m / 2) * 0.5;
    else if (m >= -2) pt = 0.5 + (m / 2) * 0.5;
    else pt = 0;
    sub += pt; denom += 1;
    c.push(`gross margin ${m >= 0 ? "+" : ""}${m.toFixed(1)}pp → ${pt.toFixed(2)}`);
  }

  // Operating margin expansion (pp) — sharper signal than gross since
  // it captures cost discipline + scale benefits. +1.5pp = 1.0.
  if (Number.isFinite(growth.opMarginExpansionPp)) {
    const m = growth.opMarginExpansionPp;
    let pt;
    if (m >= 1.5) pt = 1;
    else if (m >= 0) pt = 0.5 + (m / 1.5) * 0.5;
    else if (m >= -1.5) pt = 0.5 + (m / 1.5) * 0.5;
    else pt = 0;
    sub += pt; denom += 1;
    c.push(`op margin ${m >= 0 ? "+" : ""}${m.toFixed(1)}pp → ${pt.toFixed(2)}`);
  }

  // FCF conversion trend (pp) — same-quarter year-ago FCF/revenue
  // ratio delta. Rising FCF conversion is often the earliest sign of
  // an inflecting business — cash arrives before it shows up in
  // GAAP earnings. +2pp = 1.0.
  if (Number.isFinite(growth.fcfConversionTrendPp)) {
    const f = growth.fcfConversionTrendPp;
    let pt;
    if (f >= 2) pt = 1;
    else if (f >= 0) pt = 0.5 + (f / 2) * 0.5;
    else if (f >= -2) pt = 0.5 + (f / 2) * 0.5;
    else pt = 0;
    sub += pt; denom += 1;
    c.push(`FCF conversion ${f >= 0 ? "+" : ""}${f.toFixed(1)}pp → ${pt.toFixed(2)}`);
  }

  // ── Turnaround archetype detector (Tier 3.1 audit Aug-28) ────────
  // Prior scoreGrowth heavily penalized negative revenue growth (0
  // score), which hid every legitimate turnaround setup — a company
  // with declining revenue AND improving 2nd derivative AND margin
  // recovery is exactly the pattern that produces multi-bagger
  // asymmetric bets. This detector adds a bonus WHEN all three
  // conditions align, so a turnaround candidate can score at or
  // above a mediocre grower:
  //   • revenueYoYPct < 0 (still declining)
  //   • revenueAccelPp > 3 (materially improving — 2nd deriv positive)
  //   • grossMarginExpansionPp > 0 OR opMarginExpansionPp > 0
  // Bonus = +0.3 to the raw sub-score. Combined with the base neutral
  // signals a turnaround typically registers 0.55-0.70, which is
  // enough to lift a candidate above minScore in the parallel rescue
  // pool without gaming the strong-fundamentals composite.
  const isTurnaround =
    Number.isFinite(growth.revenueYoYPct) && growth.revenueYoYPct < 0
    && Number.isFinite(growth.revenueAccelPp) && growth.revenueAccelPp > 3
    && ((Number.isFinite(growth.grossMarginExpansionPp) && growth.grossMarginExpansionPp > 0)
      || (Number.isFinite(growth.opMarginExpansionPp) && growth.opMarginExpansionPp > 0));
  if (isTurnaround) {
    sub += 0.3 * (denom || 1);
    c.push(`TURNAROUND detected — declining revenue (${growth.revenueYoYPct.toFixed(1)}%) BUT accelerating (${growth.revenueAccelPp.toFixed(1)}pp) with margin expansion → +0.30`);
  }

  // Note: no min(1) clamp — the log-scaled Tier-1 un-saturation is
  // designed to let hypergrowth names score >1.0 on this factor so
  // they can outrank moderate growers. The composite path weights this
  // at 0.15, so a 1.3 growth factor contributes 0.195 — still bounded
  // by the composite normalization downstream.
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

  // ── Tier 2.2: RS acceleration / new-leadership detector ─────────
  // Audit Aug-28: scoring each window in isolation misses the
  // "emerging leadership" pattern — a stock quiet over 12M (or even
  // a laggard) whose 3M RS is suddenly leading is exactly the kind of
  // pattern that identifies rotation-driven winners. Bonus applied
  // when short-window RS materially exceeds long-window RS, gated by
  // both windows existing.
  //   3M − 12M-proxy(6M): +5pp = emerging, +10pp = strong emergence.
  // We only have 1M/3M/6M so use 6M as the "long" reference. Fires
  // as an additive bonus (up to +0.15 on the normalized RS score) to
  // preserve the existing window-level contributions.
  if (Number.isFinite(rs3mPp) && Number.isFinite(rs6mPp) && denom > 0) {
    const emergencePp = rs3mPp - rs6mPp;
    let bonus = 0;
    if (emergencePp >= 10) bonus = 0.15;
    else if (emergencePp >= 5) bonus = 0.10;
    else if (emergencePp >= 2) bonus = 0.05;
    if (bonus > 0) {
      // Divide by denom so total score stays in [0, 1] with headroom.
      // Effectively: emerging leadership adds up to ~15% to the RS score.
      sub += bonus * denom;
      c.push(`RS emergence (3M − 6M = ${emergencePp >= 0 ? "+" : ""}${emergencePp.toFixed(1)}pp) → bonus +${bonus.toFixed(2)}`);
    }
  }

  return denom > 0
    ? { score: Math.min(1, sub / denom), contributors: c }
    : { score: 0.5, contributors: ["no RS windows — neutral"] };
}

// Insider — recent cluster buy signal + velocity (Tier 2.2 audit
// Aug-28). Baseline signal (clusterBuy/clusterSell) unchanged. Velocity
// adds a bonus/penalty when cluster activity is materially accelerating
// or cooling window-over-window:
//   velocityDeltaPct ≥ +50%   → +0.10 (accelerating conviction)
//   velocityDeltaPct ≤ −50%   → −0.10 (conviction cooling)
//   otherwise no adjustment
// Score is clamped to [0, 1] so bonus can't overflow.
export function scoreInsider(insider) {
  if (!insider) return { score: 0.5, contributors: ["no insider signal — neutral"] };
  let base;
  const contributors = [];
  if (insider.clusterBuy) { base = 1; contributors.push("insider cluster BUY detected"); }
  else if (insider.clusterSell) { base = 0; contributors.push("insider cluster SELL detected"); }
  else { base = 0.5; contributors.push("insider activity mixed — neutral"); }
  // Velocity delta (optional field).
  if (Number.isFinite(insider.velocityDeltaPct)) {
    const v = insider.velocityDeltaPct;
    let bonus = 0;
    if (v >= 100) bonus = 0.15;
    else if (v >= 50) bonus = 0.10;
    else if (v >= 25) bonus = 0.05;
    else if (v <= -100) bonus = -0.15;
    else if (v <= -50) bonus = -0.10;
    else if (v <= -25) bonus = -0.05;
    if (bonus !== 0) {
      base = Math.max(0, Math.min(1, base + bonus));
      contributors.push(`cluster velocity ${v >= 0 ? "+" : ""}${Math.round(v)}% → ${bonus >= 0 ? "+" : ""}${bonus.toFixed(2)}`);
    }
  }
  return { score: base, contributors };
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
