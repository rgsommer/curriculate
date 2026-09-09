// backend/services/stocksOpportunityScore.js
//
// P2  (2026-09-08) — OQ scorer with missing-factor weight redistribution.
// P2.5 (2026-09-09) — HARDENED: critical-factor gating + factorCoveragePct.
//
// A candidate no longer receives OQ 90 when half the important factors
// are missing and the surviving weights redistribute upward. Each
// model declares a `criticalFactors` list. If a critical factor is
// missing, the scorer returns:
//
//   { status: "INSUFFICIENT_DATA", missingCriticalFactors: [...] }
//
// A non-critical missing factor still redistributes weight (with the
// composite reported at reduced factorCoveragePct + presentWeightSum
// so downstream code / P4 attribution can weigh accordingly).
//
// Also new: `factorCoveragePct` (0..100) reports the share of the
// model's declared weight that had data. Downstream consumers can
// downgrade confidence when coverage is low even for non-critical
// models.
//
// Inputs (each optional):
//   fundamentalsScore, growthScore, revisionsScore, relativeStrengthScore,
//   insiderScore, industryStrengthScore, priceTargetContextScore,
//   postEarningsDriftScore, catalystQualityScore
// Plus meta:
//   industryStrengthMeta: { source: "industry-peers" | "sector-fallback" | "unavailable" }
//   revisionsMeta:        { hasReal4wBaseline: bool }
//   surpriseMeta:         { present: bool }
//   catalystMeta:         { present: bool }

import { getModel, OQ_FACTORS } from "./stocksScoringModels.js";

// Interpret criticalFactors entries: a "|" splits alternatives (any
// one of them satisfies the critical requirement).
function isCriticalSatisfied(critEntry, presentSet) {
  const alts = critEntry.split("|");
  return alts.some(f => presentSet.has(f));
}

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
    priceTargetContext: pickNumber(input?.priceTargetContextScore),
    postEarningsDrift: pickNumber(input?.postEarningsDriftScore),
    catalystQuality: pickNumber(input?.catalystQualityScore),
  };

  // "Real revisions" gate — Model C's `revisions` factor is only
  // satisfied when the P2.5 real-EPS-revision baseline is present.
  // If the score came from the OLD price-target proxy alone (i.e.
  // revisionsMeta.hasReal4wBaseline === false), TREAT the revisions
  // sub-score as MISSING for critical-factor checks. It still
  // contributes to the weighted score at diminished authority, but
  // Model C's critical gate fires.
  const revIsReal = !!(input?.revisionsMeta?.hasReal4wBaseline);
  const presentSet = new Set();
  for (const f of OQ_FACTORS) {
    if (rawScores[f] == null) continue;
    if (f === "revisions" && !revIsReal) continue; // present-for-weight, absent-for-critical
    presentSet.add(f);
  }
  const missingCritical = (model.criticalFactors || []).filter(critEntry => !isCriticalSatisfied(critEntry, presentSet));

  if (missingCritical.length > 0) {
    return {
      status: "INSUFFICIENT_DATA",
      score: null,
      factorScores: rawScores,
      factorContributions: [],
      model: model.id,
      missingCriticalFactors: missingCritical,
      factorCoveragePct: 0,
      presentWeightSum: 0,
      note: `Model ${model.id} requires ${missingCritical.join(" AND ")} — not present with acceptable coverage.`,
    };
  }

  // Standard OQ weighted sum with missing-factor redistribution for
  // NON-critical factors.
  const presentWeights = {};
  const missing = [];
  let presentWeightSum = 0;
  let declaredWeightSum = 0;
  for (const f of OQ_FACTORS) {
    const weight = w[f] || 0;
    declaredWeightSum += weight;
    const s = rawScores[f];
    if (s == null) { if (weight > 0) missing.push(f); continue; }
    presentWeights[f] = weight;
    presentWeightSum += weight;
  }

  if (presentWeightSum <= 0 || declaredWeightSum <= 0) {
    return {
      status: "INSUFFICIENT_DATA",
      score: null,
      factorScores: rawScores,
      factorContributions: [],
      model: model.id,
      missingCriticalFactors: [],
      factorCoveragePct: 0,
      presentWeightSum: 0,
      note: `Model ${model.id} had no factor data.`,
    };
  }

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
  const factorCoveragePct = Math.round((presentWeightSum / declaredWeightSum) * 100);

  // Confidence dampening — industry-strength via sector-fallback halves
  // its trust for models that explicitly require industry (F).
  let confidenceStamp = "HIGH";
  const industrySource = input?.industryStrengthMeta?.source;
  const modelWantsIndustry = (model.criticalFactors || []).some(c => c.split("|").includes("industryStrength"));
  if (modelWantsIndustry && industrySource === "sector-fallback") {
    confidenceStamp = "MEDIUM"; // usable, but not real industry data
  }
  if (factorCoveragePct < 60) confidenceStamp = "LOW";
  if (factorCoveragePct < 40) confidenceStamp = "LOW";

  return {
    status: "OK",
    score: Math.round(weightedSum * 100),
    factorScores: rawScores,
    factorContributions: contributions,
    model: model.id,
    missingFactors: missing,               // non-critical missing
    missingCriticalFactors: [],
    factorCoveragePct,
    presentWeightSum,
    confidenceStamp,
    note: null,
  };
}

function pickNumber(v) {
  if (v == null) return null;
  if (typeof v === "object" && "score" in v) return Number.isFinite(v.score) ? v.score : null;
  return Number.isFinite(v) ? v : null;
}
