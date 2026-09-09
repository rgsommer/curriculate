// backend/services/stocksEntryScore.js
//
// P2 (2026-09-08) — ENTRY QUALITY score. "WHEN to buy."
//
// Deliberately independent of underlying opportunity quality. A
// beautiful chart on a mediocre company does NOT become a
// high-conviction BUY. That behaviour is protected by the champion
// combine weights (`combineWeights.opportunity` ≥ `combineWeights.entry`
// in every declared model) and by the OQ / EQ split in the pick
// engine downstream.
//
// Inputs — each is 0..1, computed from `tech` (from getTechnicals):
//   trend         — trend up (SMA50>SMA200 + price>SMA50, 5-day slope)
//   setup         — presence of a named setup (VCP / flag / coiled spring / pocket pivot)
//   mtf           — multi-timeframe confluence (aligned)
//   rsi           — RSI in the constructive band (50-70 sweet spot; 70-80 stretched; >80 exhaustion)
//   rvol          — relative volume vs 50d average (>1.5 constructive)
//   extension     — INVERSE penalty on extension above SMA50 (>15% above SMA50 is stretched)
//
// A missing input (null) is EXCLUDED from the weighted sum and its
// weight is redistributed across the present factors, keeping the
// composite interpretable at 0..1.

import { getModel } from "./stocksScoringModels.js";

const EQ_FACTORS = ["trend", "setup", "mtf", "rsi", "rvol", "extension"];

// Given a `tech` object from getTechnicals, derive the 0..1 sub-scores
// this scorer expects. Callers can also pass sub-scores directly.
export function deriveEntrySubScoresFromTech(tech) {
  if (!tech || !tech.ok) return {};
  const out = {};

  // Trend: hard 1.0 if SMA50>SMA200 and price>SMA50; 0.6 if price>SMA50
  // but SMA50<SMA200; 0.3 if price above SMA50 alone; 0 otherwise.
  if (tech.sma50 && tech.sma200 && Number.isFinite(tech.priceVsSma50)) {
    if (tech.sma50 > tech.sma200 && tech.priceVsSma50 >= 0) out.trend = 1.0;
    else if (tech.priceVsSma50 >= 0) out.trend = 0.6;
    else out.trend = 0.0;
  } else if (Number.isFinite(tech.priceVsSma50) && tech.priceVsSma50 >= 0) {
    out.trend = 0.3;
  }

  // Setup: named setup present ⇒ 1.0, else null (missing).
  if (tech.setupName) out.setup = 1.0;

  // MTF: aligned ⇒ 1.0; mixed ⇒ 0.5; opposed ⇒ 0; missing ⇒ null.
  if (tech.mtfConfluence === "aligned") out.mtf = 1.0;
  else if (tech.mtfConfluence === "mixed") out.mtf = 0.5;
  else if (tech.mtfConfluence === "opposed") out.mtf = 0;

  // RSI band: 50-65 = 1.0 (sweet spot); 65-70 = 0.8; 70-75 = 0.5;
  // 75-80 = 0.3 (stretched); >80 = 0.1 (exhaustion). Below 50 = 0.4
  // (weak momentum but not necessarily wrong).
  if (Number.isFinite(tech.rsi14)) {
    const r = tech.rsi14;
    if (r >= 50 && r <= 65) out.rsi = 1.0;
    else if (r > 65 && r <= 70) out.rsi = 0.8;
    else if (r > 70 && r <= 75) out.rsi = 0.5;
    else if (r > 75 && r <= 80) out.rsi = 0.3;
    else if (r > 80) out.rsi = 0.1;
    else out.rsi = 0.4;
  }

  // RVOL: 1.0 if >2.0; 0.7 if 1.5-2.0; 0.4 if 1.0-1.5; 0.1 below 1.0.
  if (Number.isFinite(tech.rvol)) {
    if (tech.rvol > 2.0) out.rvol = 1.0;
    else if (tech.rvol > 1.5) out.rvol = 0.7;
    else if (tech.rvol > 1.0) out.rvol = 0.4;
    else out.rvol = 0.1;
  }

  // Extension penalty: distance from SMA50. Under 8% = 1.0; 8-15% = 0.6;
  // 15-25% = 0.3; > 25% = 0.05 (chase risk). Below SMA50 = 0.7 (not
  // extended, but not confirming either).
  if (Number.isFinite(tech.priceVsSma50)) {
    const p = tech.priceVsSma50;
    if (p < 0) out.extension = 0.7;
    else if (p < 8) out.extension = 1.0;
    else if (p < 15) out.extension = 0.6;
    else if (p < 25) out.extension = 0.3;
    else out.extension = 0.05;
  }

  return out;
}

export function computeEntryScore(subScoresOrTech, modelIdOrModel = "A", options = {}) {
  const model = typeof modelIdOrModel === "string" ? getModel(modelIdOrModel) : modelIdOrModel;
  const w = model.entryWeights;
  // Accept either raw sub-scores or a getTechnicals-shaped object.
  const scores = options.derivedFromTech
    ? subScoresOrTech
    : (subScoresOrTech && subScoresOrTech.ok
       ? deriveEntrySubScoresFromTech(subScoresOrTech)
       : subScoresOrTech || {});
  const presentWeights = {};
  const missing = [];
  let presentWeightSum = 0;
  for (const f of EQ_FACTORS) {
    const s = pickNumber(scores[f]);
    const weight = w[f] || 0;
    if (s == null) { if (weight > 0) missing.push(f); continue; }
    presentWeights[f] = { w: weight, s };
    presentWeightSum += weight;
  }
  if (presentWeightSum <= 0) {
    return { score: 0, factorScores: scores, model: model.id,
             missingFactors: missing, factorContributions: [] };
  }
  const scaled = 1 / presentWeightSum;
  let weightedSum = 0;
  const contributions = [];
  for (const [f, e] of Object.entries(presentWeights)) {
    const w2 = e.w * scaled;
    weightedSum += e.s * w2;
    contributions.push({ factor: f, subScore: e.s, weight: w2, contribution: e.s * w2 });
  }
  return {
    score: Math.round(weightedSum * 100),
    factorScores: scores,
    factorContributions: contributions,
    model: model.id,
    missingFactors: missing,
    presentWeightSum,
  };
}

// PUBLIC — combine an OQ score (0..100) and an EQ score (0..100) into
// a single composite for the given model. Never used to REDUCE
// opportunity quality's authority — the model's combine weights
// declare the relative importance and every declared model gives
// opportunity ≥ entry weight.
export function combineOqEq(oqScore, eqScore, modelIdOrModel = "A") {
  const model = typeof modelIdOrModel === "string" ? getModel(modelIdOrModel) : modelIdOrModel;
  const cw = model.combineWeights;
  const oq = Number.isFinite(oqScore) ? oqScore : 0;
  const eq = Number.isFinite(eqScore) ? eqScore : 0;
  return Math.round(oq * cw.opportunity + eq * cw.entry);
}

// Tier labels for the operator-facing card. A pick with high OQ and
// low EQ is the WATCH — HIGH-QUALITY / ENTRY-NOT-READY case, tracked
// as its own first-class row (StocksWatchListEntry) so P3/P4 can
// measure how many of these become winners while we waited.
export function classifyOqEqTier({ opportunityScore, entryScore }) {
  const oq = Number(opportunityScore) || 0;
  const eq = Number(entryScore) || 0;
  if (oq >= 75 && eq >= 70) return "BUY_CANDIDATE";
  if (oq >= 75 && eq < 70)  return "WATCH_HIGH_QUALITY_NO_ENTRY";
  if (oq >= 60 && eq >= 75) return "WATCH_SETUP_NO_QUALITY";      // pretty chart, mediocre company
  if (oq >= 60 && eq >= 60) return "OK";
  return "BELOW_THRESHOLD";
}

function pickNumber(v) {
  if (v == null) return null;
  if (typeof v === "object" && "score" in v) return Number.isFinite(v.score) ? v.score : null;
  return Number.isFinite(v) ? v : null;
}
