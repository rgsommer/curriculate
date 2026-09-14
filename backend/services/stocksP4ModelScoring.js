// backend/services/stocksP4ModelScoring.js
//
// P4.1 (2026-09-11) — apply each frozen model's own formula against
// a candidate's raw factor bundle. The P4 pilot proved persistence
// but scored all models identically because the runner fed one
// pre-computed combinedScore to every model. This module fixes that.
//
// Contract: one candidate row carries every raw factor score
// (fundamentals 0-100, growth 0-100, revisions 0-100, …) plus every
// entry sub-score (trend 0-100, setup 0-100, …). applyModelScoring
// takes the raw row and applies the model's frozen opportunity
// weights, entry weights and combine weights to produce:
//   opportunityScore, entryScore, combinedScore, classification,
//   confidence, criticalFactorCoverage, factorCoveragePct,
//   failedGates, factorBreakdown
//
// The point of P4.1 is that a fixture where two models see the
// same raw candidate but use different weights MUST produce
// different combinedScores. A regression test asserts this.

import { SCORING_MODELS, ALL_MODEL_IDS } from "./stocksScoringModels.js";

// Which raw factors count toward Opportunity coverage. Missing → 0.
const OQ_FACTORS = [
  "fundamentals", "growth", "revisions", "priceTargetContext",
  "relativeStrength", "insider", "industryStrength",
  "postEarningsDrift", "catalystQuality",
];
const EQ_FACTORS = ["trend", "setup", "mtf", "rsi", "rvol", "extension"];

function weightedSum(subScores, weights, factors) {
  let sum = 0, wSum = 0, contributed = 0;
  for (const f of factors) {
    const w = Number(weights?.[f]) || 0;
    if (w <= 0) continue;
    const s = Number(subScores?.[f]);
    if (Number.isFinite(s)) { sum += s * w; wSum += w; contributed++; }
  }
  return { score: wSum > 0 ? sum / wSum : null, coveredWeight: wSum, contributedFactors: contributed };
}

function criticalCoverageForModel(model, subScores) {
  const critical = model.criticalFactors || [];
  const missing = [];
  for (const key of critical) {
    // "postEarningsDrift|catalystQuality" — ANY-ONE satisfies.
    if (key.includes("|")) {
      const options = key.split("|");
      const anyPresent = options.some(k => Number.isFinite(subScores?.[k]));
      if (!anyPresent) missing.push(key);
    } else {
      if (!Number.isFinite(subScores?.[key])) missing.push(key);
    }
  }
  return { pass: missing.length === 0, missing };
}

// PUBLIC — score ONE candidate under ONE model. Returns a fully
// populated per-model row.
export function applyModelScoring(candidate, modelId) {
  const model = SCORING_MODELS[modelId];
  if (!model) throw new Error(`Unknown model ${modelId}`);
  // Passive control: no scoring, just carry the reference price.
  if (modelId === "G") {
    return {
      model: "G", modelLabel: model.label,
      opportunityScore: null, entryScore: null, combinedScore: null,
      classification: "BUY_CANDIDATE",  // passive is always "own it"
      confidence: "PASSIVE",
      criticalFactorCoverage: null,
      factorCoveragePct: null,
      failedGates: [],
      factorBreakdown: null,
      weightsUsed: null,
    };
  }

  const oqSubs = candidate.oqSubScores || {};
  const eqSubs = candidate.eqSubScores || {};
  const critical = criticalCoverageForModel(model, oqSubs);

  const { score: oqScore, coveredWeight: oqCoverage, contributedFactors: oqContrib } =
    weightedSum(oqSubs, model.opportunityWeights, OQ_FACTORS);
  const { score: eqScore, coveredWeight: eqCoverage, contributedFactors: eqContrib } =
    weightedSum(eqSubs, model.entryWeights, EQ_FACTORS);

  // Critical-gate: missing critical factors → INSUFFICIENT_DATA per P2.5
  // contract. Do NOT redistribute weight silently.
  if (!critical.pass) {
    return {
      model: modelId, modelLabel: model.label,
      opportunityScore: null, entryScore: null, combinedScore: null,
      classification: "REJECTED",
      confidence: "INSUFFICIENT_DATA",
      criticalFactorCoverage: false,
      factorCoveragePct: Math.round((oqCoverage + eqCoverage) * 50),
      failedGates: [`missing-critical:${critical.missing.join("|")}`],
      factorBreakdown: { oq: pickFactorBreakdown(oqSubs, model.opportunityWeights),
                         eq: pickFactorBreakdown(eqSubs, model.entryWeights) },
      weightsUsed: { opportunity: model.opportunityWeights, entry: model.entryWeights, combine: model.combineWeights },
    };
  }

  const combined = (Number.isFinite(oqScore) && Number.isFinite(eqScore))
    ? oqScore * model.combineWeights.opportunity + eqScore * model.combineWeights.entry
    : null;

  const failedGates = [];
  // Coverage floor: at least 60% of the OQ weight must have a real
  // sub-score behind it — otherwise the score is not credible.
  const oqCoveragePct = oqCoverage * 100;
  if (oqCoveragePct < 60) failedGates.push(`oq-coverage<60% (${oqCoveragePct.toFixed(0)}%)`);
  const eqCoveragePct = eqCoverage * 100;
  if (eqCoveragePct < 60) failedGates.push(`eq-coverage<60% (${eqCoveragePct.toFixed(0)}%)`);

  const confidence = combined == null ? "LOW"
    : (oqCoveragePct >= 80 && eqCoveragePct >= 80) ? "HIGH"
    : (oqCoveragePct >= 60 && eqCoveragePct >= 60) ? "MEDIUM"
    : "LOW";

  const classification = classifyForP4(oqScore, eqScore, combined, failedGates);

  return {
    model: modelId, modelLabel: model.label,
    opportunityScore: round1(oqScore), entryScore: round1(eqScore),
    combinedScore: round1(combined),
    classification, confidence,
    criticalFactorCoverage: true,
    factorCoveragePct: Math.round((oqCoveragePct + eqCoveragePct) / 2),
    failedGates,
    factorBreakdown: {
      oq: pickFactorBreakdown(oqSubs, model.opportunityWeights),
      eq: pickFactorBreakdown(eqSubs, model.entryWeights),
    },
    weightsUsed: {
      opportunity: model.opportunityWeights,
      entry: model.entryWeights,
      combine: model.combineWeights,
    },
  };
}

function classifyForP4(oq, eq, combined, gates) {
  if (gates.length > 0) return "REJECTED";
  const oqOk = (oq ?? 0) >= 65;
  const eqOk = (eq ?? 0) >= 65;
  const combinedOk = (combined ?? 0) >= 68;
  if (oqOk && eqOk && combinedOk) return "BUY_CANDIDATE";
  if (oqOk && !eqOk) return "WATCH_HIGH_QUALITY_NO_ENTRY";
  if (!oqOk && eqOk) return "WATCH_SETUP_NO_QUALITY";
  return "REJECTED";
}

function pickFactorBreakdown(subs, weights) {
  const out = {};
  for (const f of Object.keys(weights || {})) {
    const w = Number(weights[f]) || 0;
    if (w <= 0) continue;
    out[f] = { subScore: Number.isFinite(subs?.[f]) ? subs[f] : null, weight: w };
  }
  return out;
}

function round1(x) { return Number.isFinite(x) ? Math.round(x * 10) / 10 : null; }

// PUBLIC — score ONE candidate under EVERY model. Uses shared raw
// factor data — no duplicate fetches (P4.1 §10).
export function scoreCandidateAllModels(candidate) {
  const rows = {};
  for (const m of ALL_MODEL_IDS) rows[m] = applyModelScoring(candidate, m);
  rows.G = applyModelScoring(candidate, "G");
  return rows;
}
