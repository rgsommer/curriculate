// backend/services/stocksP4Promotion.js
//
// P4 (2026-09-11) — champion / challenger promotion helper.
// Production traffic is NEVER changed by this module — it only
// evaluates the preregistered criteria and emits a proposal.
//
// A challenger is promoted only when:
//   1. Preregistered thresholds pass (spec §15 + §17).
//   2. The user explicitly approves. This module marks
//      PROMOTION_ELIGIBLE; a separate CLI step flips a state row
//      to PROMOTED after user acknowledgement.
//
// Robustness check: the challenger's ranking must survive removing
// its single best pick (spec §15 robustness clause) so one moonshot
// cannot p-hack the promotion.

import StocksP4ChampionState from "../models/StocksP4ChampionState.js";
import StocksP4Outcome from "../models/StocksP4Outcome.js";
import StocksP4PickRecord from "../models/StocksP4PickRecord.js";
import StocksP4Experiment from "../models/StocksP4Experiment.js";
import StocksP4ExperimentStatus from "../models/StocksP4ExperimentStatus.js";
import { CHAMPION_MODEL_ID, ALL_MODEL_IDS } from "./stocksScoringModels.js";

// PUBLIC — evaluate every challenger against the frozen promotion
// criteria for this experiment. Returns { proposals, none } — never
// mutates production. Marks challengers PROMOTION_ELIGIBLE where
// justified but does not flip to PROMOTED.
export async function evaluatePromotions({ experimentId, horizonDays = 20 }) {
  const experiment = await StocksP4Experiment.findOne({ experimentId }).lean();
  if (!experiment) throw new Error(`Unknown experimentId: ${experimentId}`);
  const st = await StocksP4ExperimentStatus.findOne({ experimentId }).lean().catch(() => null);
  if (st && st.status === "PILOT_INVALID") {
    return { experimentId, status: "EXCLUDED", reason: st.invalidationReason, proposals: [] };
  }
  const criteria = experiment.promotionCriteria;

  const outcomes = await StocksP4Outcome.find({ experimentId }).lean();
  const byModel = new Map();
  for (const o of outcomes) {
    const h = (o.horizons || []).find(x => x.horizonDays === horizonDays && x.status === "FILLED");
    if (!h || !Number.isFinite(h.alphaPp)) continue;
    if (!byModel.has(o.model)) byModel.set(o.model, []);
    byModel.get(o.model).push({ alphaPp: h.alphaPp, ticker: o.ticker });
  }

  const champion = statsFor(byModel.get(CHAMPION_MODEL_ID) || []);
  const proposals = [];
  // P4.1 §4: only real challengers (B-F) can be evaluated for promotion.
  // Model G is the passive CONTROL — reported for context but never
  // promoted. ALL_MODEL_IDS excludes G by construction, but we also
  // hard-skip here for clarity.
  for (const model of ALL_MODEL_IDS) {
    if (model === CHAMPION_MODEL_ID) continue;
    if (model === "G") continue;
    const samples = byModel.get(model) || [];
    const stats = statsFor(samples);
    const robust = robustnessCheck(samples, criteria);
    const check = evaluateAgainst(stats, champion, criteria, robust);
    if (check.pass) {
      proposals.push({
        model, horizonDays, stats, championStats: champion, robust,
        preRegistered: criteria, checks: check.checks,
        recommendation: `PROMOTION PROPOSAL: ${model} beats champion A on preregistered criteria at ${horizonDays}d — requires user approval before production change.`,
      });
      await StocksP4ChampionState.updateOne(
        { experimentId, modelId: model },
        { $set: { state: "PROMOTION_ELIGIBLE", evidenceSnapshot: { stats, championStats: champion, checks: check.checks }, lastEvaluatedAt: new Date() } },
      ).catch(() => null);
    } else {
      await StocksP4ChampionState.updateOne(
        { experimentId, modelId: model },
        { $set: { state: "CHALLENGER", evidenceSnapshot: { stats, championStats: champion, checks: check.checks, failedGates: check.failedGates }, lastEvaluatedAt: new Date() } },
      ).catch(() => null);
    }
  }
  return { experimentId, horizonDays, proposals };
}

function statsFor(samples) {
  if (!samples.length) return { n: 0, mean: null, median: null, hitRatePct: null, best: null, worst: null };
  const alphas = samples.map(s => s.alphaPp).sort((a, b) => a - b);
  const median = alphas.length % 2 ? alphas[(alphas.length - 1) / 2] : 0.5 * (alphas[alphas.length / 2 - 1] + alphas[alphas.length / 2]);
  const mean = alphas.reduce((a, b) => a + b, 0) / alphas.length;
  const hitRatePct = (alphas.filter(a => a > 0).length / alphas.length) * 100;
  return { n: alphas.length, mean, median, hitRatePct, best: alphas[alphas.length - 1], worst: alphas[0] };
}

function robustnessCheck(samples, criteria) {
  if (!criteria.robustWithoutTopWinner || samples.length < 3) return true;
  const sorted = [...samples].sort((a, b) => b.alphaPp - a.alphaPp);
  const withoutTop = statsFor(sorted.slice(1));
  return withoutTop.median > 0;
}

function evaluateAgainst(stats, champion, criteria, robust) {
  const checks = {
    sufficientSamples: stats.n >= criteria.minMature20dObservations,
    medianPositive: stats.median > criteria.minPositiveMedianAlpha20dPp,
    meanPositive: stats.mean > criteria.minPositiveMeanAlpha20dPp,
    beatsChampionMedian: stats.median - (champion.median ?? -Infinity) >= criteria.mustBeatChampionMedianPp,
    robust,
  };
  const failedGates = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { pass: failedGates.length === 0, checks, failedGates };
}
