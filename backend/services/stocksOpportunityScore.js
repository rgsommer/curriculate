// backend/services/stocksOpportunityScore.js
//
// P2 (2026-09-08) — OPPORTUNITY QUALITY score. "WHAT to own."
//
// Deliberately independent of chart / entry setup: two identical
// companies with different chart timing should score identically on
// opportunity quality. Whether we act on that opportunity today is
// the ENTRY QUALITY question, computed by stocksEntryScore.js.
//
// Consumes factor sub-scorers already in the codebase
// (stocksMultiFactorScore.js) — each returns { score: 0..1,
// contributors[] } for auditability. We do NOT re-derive those inside
// this module; we combine them with the model's per-factor weights.
//
// Inputs:
//   input.fundamentalsScore    — 0..1  from scoreFundamentals
//   input.growthScore          — 0..1  from scoreGrowth
//   input.revisionsScore       — 0..1  from scoreEstimateRevisions
//   input.relativeStrengthScore — 0..1 from scoreRelativeStrength
//   input.insiderScore         — 0..1  from scoreInsider
//   input.industryStrengthScore — 0..1 from stocksIndustryStrength
//                                (may be null → falls back to sector RS)
//   input.contributors         — { fundamentals, growth, revisions,
//                                  relativeStrength, insider,
//                                  industryStrength } — per-factor
//                                  human-readable contributor strings
//                                  (for provenance)
//   model                      — from stocksScoringModels.getModel(id)
//
// Output:
//   { score: 0..100, factorScores: {...}, factorContributions: [...],
//     model: id, missingFactors: [...] }
//
// A factor with a null sub-score is EXCLUDED from the weighted sum
// AND its weight is redistributed proportionally across the present
// factors. That keeps the score interpretable at 0..1 (× 100) even
// when e.g. revisions data is missing. The missing factors are
// reported in `missingFactors` so downstream calibration can weigh
// coverage vs completeness.

import { getModel } from "./stocksScoringModels.js";

const OQ_FACTORS = [
  "fundamentals", "growth", "revisions",
  "relativeStrength", "insider", "industryStrength",
];

export function computeOpportunityScore(input, modelIdOrModel = "A") {
  const model = typeof modelIdOrModel === "string" ? getModel(modelIdOrModel) : modelIdOrModel;
  const w = model.opportunityWeights;
  const rawScores = {
    fundamentals: pickNumber(input?.fundamentalsScore),
    growth: pickNumber(input?.growthScore),
    revisions: pickNumber(input?.revisionsScore),
    relativeStrength: pickNumber(input?.relativeStrengthScore),
    insider: pickNumber(input?.insiderScore),
    industryStrength: pickNumber(input?.industryStrengthScore),
  };

  const presentWeights = {};
  const missing = [];
  let presentWeightSum = 0;
  for (const f of OQ_FACTORS) {
    const s = rawScores[f];
    const weight = w[f] || 0;
    if (s == null) { if (weight > 0) missing.push(f); continue; }
    presentWeights[f] = weight;
    presentWeightSum += weight;
  }
  if (presentWeightSum <= 0) {
    return { score: 0, factorScores: rawScores, model: model.id,
             missingFactors: missing, factorContributions: [] };
  }
  // Re-normalize present-factor weights so the composite stays 0..1.
  const scaled = 1 / presentWeightSum;
  let weightedSum = 0;
  const contributions = [];
  for (const f of OQ_FACTORS) {
    if (presentWeights[f] == null) continue;
    const s = rawScores[f];
    const w2 = presentWeights[f] * scaled;
    weightedSum += s * w2;
    contributions.push({
      factor: f,
      subScore: s,
      weight: w2,
      contribution: s * w2,
      contributors: (input?.contributors && input.contributors[f]) || [],
    });
  }
  return {
    score: Math.round(weightedSum * 100),
    factorScores: rawScores,
    factorContributions: contributions,
    model: model.id,
    missingFactors: missing,
    presentWeightSum,
  };
}

function pickNumber(v) {
  if (v == null) return null;
  if (typeof v === "object" && "score" in v) return Number.isFinite(v.score) ? v.score : null;
  return Number.isFinite(v) ? v : null;
}
