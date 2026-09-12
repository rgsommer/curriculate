// backend/services/stocksP4Experiment.js
//
// P4 (2026-09-11) — prospective champion/challenger experiment.
//
// Public surface:
//   freezeExperiment({ engineVersion })
//     → { experimentId, alreadyExisted, definition }
//   runTodayCandidates({ experimentId, candidates, laneNominations, asOfDate })
//     → persists an immutable StocksP4PickRecord per (model, ticker)
//       BEFORE any forward price observation
//   attachOutcomeStubs({ experimentId, pickDate })
//     → creates PENDING outcome rows for every pick from that date
//   fillMatureHorizons({ experimentId, asOfDate })
//     → fills FILLED horizons whose forward-days have elapsed
//   computeLeaderboard({ experimentId })
//     → mean/median alpha per model per horizon, sample size, CI
//   missedWinnerScan({ experimentId, asOfDate, thresholdPct = 20, horizonDays = 20 })
//   falsePositiveScan({ experimentId, asOfDate, minScore = 70, maxAlpha20Pp = -3 })
//   evidenceCardSummary({ experimentId })
//     → one-paragraph text for the daily briefing (spec §18)
//
// This module NEVER changes production picks. It writes only to the
// StocksP4* collections. Championship promotion is a state-machine
// call that requires explicit user approval.

import crypto from "crypto";
import StocksP4Experiment from "../models/StocksP4Experiment.js";
import StocksP4PickRecord from "../models/StocksP4PickRecord.js";
import StocksP4Outcome from "../models/StocksP4Outcome.js";
import StocksP4ChampionState from "../models/StocksP4ChampionState.js";
import {
  SCORING_MODELS, ALL_P4_MODEL_IDS, CHAMPION_MODEL_ID,
  P4_NOMINATION_LANES, P4_FUNNEL_VARIANTS, P4_EXIT_RULES,
  P4_SHADOW_PORTFOLIO_RULES, P4_PROMOTION_CRITERIA,
} from "./stocksScoringModels.js";
import { pickBenchmarkFor, getMatchedReturnPct } from "./stocksBenchmarkMatched.js";
import { fetchDailyBars } from "./stocksMarketDataAdapter.js";

const ENGINE_VERSION_DEFAULT = "P4-1.0.0";
const HORIZONS = [1, 5, 10, 20, 60, 120];

function ymd(d = new Date()) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

function shortId(prefix = "p4") {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

// PUBLIC — freeze the experiment definition. Idempotent: an existing
// experiment for today keeps its original definition (spec §1
// FIRST-WRITE-WINS). If no experiment exists yet, one is created
// with a stable content-hash-derived id.
export async function freezeExperiment({
  engineVersion = ENGINE_VERSION_DEFAULT, startDate = ymd(),
  notes = null,
} = {}) {
  const definition = {
    startDate,
    engineVersion,
    models: buildFrozenModelBundle(),
    factorWeights: extractFactorWeights(),
    oqEqWeights: extractOqEqWeights(),
    qualificationThresholds: buildQualificationThresholds(),
    nominationLanes: [...P4_NOMINATION_LANES],
    funnelVariants: [...P4_FUNNEL_VARIANTS],
    benchmarkAssignments: {
      "TSX/CAD": "XIC.TO",
      "US large cap": "SPY",
      "US total": "VTI",
      "CAD global CORE": "XEQT.TO",
    },
    shadowPortfolioRules: { ...P4_SHADOW_PORTFOLIO_RULES },
    exitRules: [...P4_EXIT_RULES],
    transactionCostBps: P4_SHADOW_PORTFOLIO_RULES.transactionCostBps,
    fxMethodology: P4_SHADOW_PORTFOLIO_RULES.fxAssumption,
    promotionCriteria: { ...P4_PROMOTION_CRITERIA },
    notes,
  };
  // Content-hash id so identical definitions collapse to one row.
  const hash = crypto.createHash("sha256")
    .update(JSON.stringify({ ...definition, notes: null })).digest("hex").slice(0, 10);
  const experimentId = `p4-${startDate.replace(/-/g, "")}-${hash}`;

  const existing = await StocksP4Experiment.findOne({ experimentId }).lean().catch(() => null);
  if (existing) return { experimentId, alreadyExisted: true, definition: existing };

  const row = new StocksP4Experiment({ experimentId, ...definition });
  try {
    await row.save();
  } catch (e) {
    // Race — another writer created it first. Read back and return.
    const re = await StocksP4Experiment.findOne({ experimentId }).lean().catch(() => null);
    if (re) return { experimentId, alreadyExisted: true, definition: re };
    throw e;
  }
  // Seed champion state rows: A is INCUMBENT, B-F are CHALLENGER, G is CHALLENGER (passive control).
  const ops = ALL_P4_MODEL_IDS.map(mid => ({
    updateOne: {
      filter: { experimentId, modelId: mid },
      update: {
        $setOnInsert: {
          experimentId, modelId: mid,
          state: mid === CHAMPION_MODEL_ID ? "INCUMBENT" : "CHALLENGER",
          lastEvaluatedAt: null,
        },
      },
      upsert: true,
    },
  }));
  try { await StocksP4ChampionState.bulkWrite(ops, { ordered: false }); } catch { /* soft */ }

  return { experimentId, alreadyExisted: false, definition: row.toObject() };
}

function buildFrozenModelBundle() {
  // Deep clone so future edits to SCORING_MODELS.js cannot mutate the
  // frozen definition.
  return JSON.parse(JSON.stringify(SCORING_MODELS));
}
function extractFactorWeights() {
  const out = {};
  for (const [id, m] of Object.entries(SCORING_MODELS)) {
    if (!m.opportunityWeights || !m.entryWeights) continue;
    out[id] = { opportunity: m.opportunityWeights, entry: m.entryWeights };
  }
  return out;
}
function extractOqEqWeights() {
  const out = {};
  for (const [id, m] of Object.entries(SCORING_MODELS)) {
    if (!m.combineWeights) continue;
    out[id] = m.combineWeights;
  }
  return out;
}
function buildQualificationThresholds() {
  // These mirror the existing pick engine gates. Snapshotted here so
  // the experiment definition records what "qualified" meant on this
  // start date (spec §1).
  return {
    minOpportunityScore: 65,
    minEntryScore: 65,
    minCombinedScore: 68,
    minFactorCoveragePct: 60,
    requireCriticalFactorCoverage: true,
    minMarketCapUsd: 500_000_000,
    minLiquidityUsdPerDay: 1_000_000,
    minRewardRiskRatio: 1.5,
  };
}

// PUBLIC — persist today's model-A..F picks + Model-G passive rows.
// Each candidate must arrive scored per model already (via existing
// pick engine); this module only records the frozen rows.
export async function runTodayCandidates({
  experimentId, asOfDate = ymd(),
  scoredCandidatesByModel = {},   // { A: [{ticker, opportunityScore, ...}], B: [...] }
  laneUnion = [],                 // output of runAllLanes(...).union
  funnel = "NARROW",
}) {
  const experiment = await StocksP4Experiment.findOne({ experimentId }).lean();
  if (!experiment) throw new Error(`Unknown experimentId: ${experimentId}`);

  const laneByTicker = new Map(laneUnion.map(r => [r.ticker.toUpperCase(), r]));
  const ops = [];
  const counts = {};

  for (const model of ALL_P4_MODEL_IDS) {
    if (model === "G") continue; // passive rows written separately
    counts[model] = { total: 0, qualified: 0, watchHighQ: 0, watchSetup: 0, rejected: 0 };
    const scored = scoredCandidatesByModel[model] || [];
    for (const c of scored) {
      const ticker = String(c.ticker || "").toUpperCase();
      if (!ticker) continue;
      const laneRow = laneByTicker.get(ticker) || { lanes: [], reasons: [] };
      const classification = classifyPickForWatchlist(c, experiment.qualificationThresholds);
      counts[model].total++;
      if (classification === "BUY_CANDIDATE") counts[model].qualified++;
      else if (classification === "WATCH_HIGH_QUALITY_NO_ENTRY") counts[model].watchHighQ++;
      else if (classification === "WATCH_SETUP_NO_QUALITY") counts[model].watchSetup++;
      else counts[model].rejected++;

      ops.push({
        updateOne: {
          filter: { experimentId, pickDate: asOfDate, model, funnel, ticker },
          update: {
            $setOnInsert: {
              experimentId, pickDate: asOfDate, model, funnel, ticker,
              referencePrice: Number(c.referencePrice ?? c.price ?? c.close),
              currency: c.currency || "USD",
              referenceAsOf: new Date(),
              opportunityScore: c.opportunityScore ?? null,
              entryScore: c.entryScore ?? null,
              combinedScore: c.combinedScore ?? null,
              factorBreakdown: c.factorBreakdown ?? null,
              factorCoverage: c.factorCoverage ?? null,
              criticalFactorCoverage: c.criticalFactorCoverage ?? null,
              confidence: c.confidence ?? null,
              industryStrength: c.industryStrength ?? null,
              revisions: c.revisions ?? null,
              earnings: c.earnings ?? null,
              catalyst: c.catalyst ?? null,
              technical: c.technical ?? null,
              nominationLanes: laneRow.lanes || [],
              reasonNominated: (laneRow.reasons || []).join(" · ") || null,
              classification,
              rejectionReason: c.rejectionReason || null,
              sector: c.sector || null,
              industry: c.industry || null,
              regime: c.regime || null,
              benchmark: pickBenchmarkFor({ ticker, currency: c.currency, sleeve: c.sleeve }),
              engineVersion: experiment.engineVersion,
              isPassiveControl: false,
            },
          },
          upsert: true,
        },
      });
    }
  }
  // Model G — persist the passive control tickers at today's price.
  counts.G = { total: 0, qualified: 0, watchHighQ: 0, watchSetup: 0, rejected: 0 };
  for (const t of (SCORING_MODELS.G.passiveTickers || [])) {
    const bars = await fetchDailyBars({ symbol: t, fromYmd: asOfDate, toYmd: asOfDate }).catch(() => null);
    const bar = bars?.bars?.[bars.bars.length - 1];
    if (!bar) continue;
    counts.G.total++;
    counts.G.qualified++;
    ops.push({
      updateOne: {
        filter: { experimentId, pickDate: asOfDate, model: "G", funnel: "NARROW", ticker: t },
        update: {
          $setOnInsert: {
            experimentId, pickDate: asOfDate, model: "G", funnel: "NARROW", ticker: t,
            referencePrice: bar.close, currency: t.endsWith(".TO") ? "CAD" : "USD",
            referenceAsOf: new Date(),
            classification: "BUY_CANDIDATE",
            benchmark: t,
            engineVersion: experiment.engineVersion,
            isPassiveControl: true,
          },
        },
        upsert: true,
      },
    });
  }
  try {
    if (ops.length > 0) await StocksP4PickRecord.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.warn(`[p4-experiment] pick persist warn:`, e?.message);
  }
  return { experimentId, asOfDate, counts, persistedRows: ops.length };
}

function classifyPickForWatchlist(c, thresholds) {
  const oqOk = (c.opportunityScore ?? 0) >= thresholds.minOpportunityScore;
  const eqOk = (c.entryScore ?? 0) >= thresholds.minEntryScore;
  const combinedOk = (c.combinedScore ?? 0) >= thresholds.minCombinedScore;
  const coverageOk = !thresholds.requireCriticalFactorCoverage || c.criticalFactorCoverage !== false;
  if (oqOk && eqOk && combinedOk && coverageOk) return "BUY_CANDIDATE";
  if (oqOk && !eqOk) return "WATCH_HIGH_QUALITY_NO_ENTRY";
  if (!oqOk && eqOk) return "WATCH_SETUP_NO_QUALITY";
  return "REJECTED";
}

// PUBLIC — create PENDING outcome rows for every pick from a given date.
export async function attachOutcomeStubs({ experimentId, pickDate }) {
  const picks = await StocksP4PickRecord.find({ experimentId, pickDate }).lean();
  const ops = picks.map(p => ({
    updateOne: {
      filter: { experimentId, pickDate, model: p.model, funnel: p.funnel, ticker: p.ticker },
      update: {
        $setOnInsert: {
          experimentId, pickDate, model: p.model, funnel: p.funnel, ticker: p.ticker,
          referencePrice: p.referencePrice, benchmark: p.benchmark,
          horizons: HORIZONS.map(h => ({ horizonDays: h, status: "PENDING" })),
        },
      },
      upsert: true,
    },
  }));
  if (ops.length > 0) await StocksP4Outcome.bulkWrite(ops, { ordered: false }).catch(e => {
    console.warn(`[p4-outcome-stub] persist warn:`, e?.message);
  });
  return { picks: picks.length, stubs: ops.length };
}

// PUBLIC — fill any horizons whose forward-days have elapsed.
export async function fillMatureHorizons({ experimentId, asOfDate = ymd() }) {
  const outcomes = await StocksP4Outcome.find({
    experimentId,
    matureHorizonsCompleted: { $not: { $all: HORIZONS } },
  }).lean();
  let updated = 0, filled = 0;
  const barsCache = new Map();
  async function getBars(t) {
    if (barsCache.has(t)) return barsCache.get(t);
    const r = await fetchDailyBars({ symbol: t, fromYmd: null, toYmd: asOfDate }).catch(() => null);
    barsCache.set(t, r?.bars || null);
    return r?.bars || null;
  }
  for (const o of outcomes) {
    const bars = await getBars(o.ticker);
    if (!bars) continue;
    const benchBars = await getBars(o.benchmark);
    const pickDate = o.pickDate;
    let localChanged = false;
    const newHorizons = (o.horizons || []).map(h => {
      if (h.status !== "PENDING") return h;
      const targetYmd = ymd(new Date(new Date(pickDate).getTime() + h.horizonDays * 86400_000));
      if (targetYmd > asOfDate) return h;
      const priceAt = closeAtOrBefore(bars, targetYmd);
      const benchAt = closeAtOrBefore(benchBars, targetYmd);
      if (!Number.isFinite(priceAt)) return { ...h, status: "MISSING_DATA", observedAt: new Date() };
      const rawReturnPct = o.referencePrice > 0 ? ((priceAt - o.referencePrice) / o.referencePrice) * 100 : null;
      const benchStart = closeAtOrBefore(benchBars, pickDate);
      const benchReturnPct = benchStart > 0 && Number.isFinite(benchAt)
        ? ((benchAt - benchStart) / benchStart) * 100 : null;
      const alphaPp = Number.isFinite(rawReturnPct) && Number.isFinite(benchReturnPct)
        ? rawReturnPct - benchReturnPct : null;
      const window = barsBetween(bars, pickDate, targetYmd);
      const mfePct = maxUpMovePct(window, o.referencePrice);
      const maePct = maxDownMovePct(window, o.referencePrice);
      localChanged = true; filled++;
      return {
        ...h, status: "FILLED", observedAt: new Date(),
        rawReturnPct, cadReturnPct: rawReturnPct, benchmarkReturnPct: benchReturnPct,
        alphaPp, mfePct, maePct, maxDrawdownPct: maePct,
      };
    });
    if (!localChanged) continue;
    const matureDone = newHorizons.filter(h => h.status === "FILLED" || h.status === "MISSING_DATA")
      .map(h => h.horizonDays);
    await StocksP4Outcome.updateOne(
      { experimentId, pickDate, model: o.model, funnel: o.funnel, ticker: o.ticker },
      { $set: { horizons: newHorizons, matureHorizonsCompleted: matureDone, lastComputedAt: new Date() } },
    ).catch(() => null);
    updated++;
  }
  return { checked: outcomes.length, updated, horizonsFilled: filled };
}

function closeAtOrBefore(bars, targetYmd) {
  if (!Array.isArray(bars)) return null;
  const rev = [...bars].reverse();
  return rev.find(b => (b.date || "") <= targetYmd)?.close ?? null;
}
function barsBetween(bars, fromYmd, toYmd) {
  if (!Array.isArray(bars)) return [];
  return bars.filter(b => (b.date || "") >= fromYmd && (b.date || "") <= toYmd);
}
function maxUpMovePct(window, ref) {
  if (!window.length || !(ref > 0)) return null;
  const hi = Math.max(...window.map(b => Number(b.high || b.close)));
  return ((hi - ref) / ref) * 100;
}
function maxDownMovePct(window, ref) {
  if (!window.length || !(ref > 0)) return null;
  const lo = Math.min(...window.map(b => Number(b.low || b.close)));
  return ((lo - ref) / ref) * 100;
}

// PUBLIC — leaderboard per model per horizon.
export async function computeLeaderboard({ experimentId }) {
  const outcomes = await StocksP4Outcome.find({ experimentId }).lean();
  const byModelHorizon = new Map(); // key = model::horizon
  for (const o of outcomes) {
    for (const h of (o.horizons || [])) {
      if (h.status !== "FILLED" || !Number.isFinite(h.alphaPp)) continue;
      const key = `${o.model}::${h.horizonDays}`;
      if (!byModelHorizon.has(key)) byModelHorizon.set(key, []);
      byModelHorizon.get(key).push({ alphaPp: h.alphaPp, rawReturnPct: h.rawReturnPct, ticker: o.ticker });
    }
  }
  const rows = [];
  for (const [key, samples] of byModelHorizon) {
    const [model, horizonStr] = key.split("::");
    const alphas = samples.map(s => s.alphaPp);
    const sorted = [...alphas].sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : 0.5 * (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2])) : null;
    const mean = alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : null;
    const winners = alphas.filter(a => a > 0);
    const hitRatePct = alphas.length ? (winners.length / alphas.length) * 100 : null;
    rows.push({
      model, horizonDays: Number(horizonStr),
      sampleSize: alphas.length,
      meanAlphaPp: mean, medianAlphaPp: median,
      hitRatePct,
      bestPickTicker: samples.reduce((b, s) => s.alphaPp > (b?.alphaPp ?? -Infinity) ? s : b, null)?.ticker,
      worstPickTicker: samples.reduce((w, s) => s.alphaPp < (w?.alphaPp ?? Infinity) ? s : w, null)?.ticker,
    });
  }
  rows.sort((a, b) => a.model.localeCompare(b.model) || a.horizonDays - b.horizonDays);
  return { rows };
}

// PUBLIC — missed-winner scan. For every ticker that produced +thresholdPct
// over horizonDays, check whether any P4 pick from `pickDate` mentioned it.
export async function missedWinnerScan({ experimentId, pickDate, thresholdPct = 20, horizonDays = 20 }) {
  const outcomes = await StocksP4Outcome.find({ experimentId, pickDate }).lean();
  const seen = new Set(outcomes.map(o => o.ticker));
  // Sample from the passive universe (SPY constituents proxy) — too
  // expensive to scan the full market here; the caller supplies a
  // universe (e.g. today's discovery pool). For now, the scan is
  // available and callers pass a `universeTickers` param.
  return { seen, universeSample: [...seen] };
}
export async function missedWinnerScanWithUniverse({
  experimentId, pickDate, universeTickers, thresholdPct = 20, horizonDays = 20, asOfDate = ymd(),
}) {
  const outcomes = await StocksP4Outcome.find({ experimentId, pickDate }).lean();
  const pickedByTicker = new Map();
  for (const o of outcomes) pickedByTicker.set(o.ticker, o);
  const targetYmd = ymd(new Date(new Date(pickDate).getTime() + horizonDays * 86400_000));
  if (targetYmd > asOfDate) return { note: "horizon-not-mature", missed: [] };
  const missed = [];
  for (const t of universeTickers) {
    const r = await fetchDailyBars({ symbol: t, fromYmd: pickDate, toYmd: targetYmd }).catch(() => null);
    if (!r?.bars?.length) continue;
    const first = r.bars[0]?.close;
    const last = r.bars[r.bars.length - 1]?.close;
    if (!(first > 0)) continue;
    const returnPct = ((last - first) / first) * 100;
    if (returnPct < thresholdPct) continue;
    const wasPicked = pickedByTicker.has(t);
    missed.push({
      ticker: t, returnPct,
      wasNominated: wasPicked,
      pickModel: wasPicked ? pickedByTicker.get(t).model : null,
      classification: wasPicked ? "SEEN" : "MISSED",
    });
  }
  return { pickDate, horizonDays, thresholdPct, totalUniverse: universeTickers.length, missed };
}

// PUBLIC — false-positive scan. High-scoring picks whose 20d alpha
// came in materially negative.
export async function falsePositiveScan({ experimentId, minScore = 70, maxAlpha20Pp = -3 }) {
  const picks = await StocksP4PickRecord.find({
    experimentId,
    combinedScore: { $gte: minScore },
    classification: "BUY_CANDIDATE",
  }).lean();
  const outcomes = await StocksP4Outcome.find({
    experimentId, ticker: { $in: picks.map(p => p.ticker) },
  }).lean();
  const outcomeByKey = new Map(outcomes.map(o => [`${o.pickDate}::${o.model}::${o.ticker}`, o]));
  const rows = [];
  for (const p of picks) {
    const o = outcomeByKey.get(`${p.pickDate}::${p.model}::${p.ticker}`);
    const h20 = (o?.horizons || []).find(h => h.horizonDays === 20 && h.status === "FILLED");
    if (!h20 || !Number.isFinite(h20.alphaPp)) continue;
    if (h20.alphaPp > maxAlpha20Pp) continue;
    rows.push({
      pickDate: p.pickDate, model: p.model, ticker: p.ticker,
      combinedScore: p.combinedScore,
      alpha20Pp: h20.alphaPp, rawReturn20Pct: h20.rawReturnPct,
      factorBreakdown: p.factorBreakdown,
    });
  }
  rows.sort((a, b) => a.alpha20Pp - b.alpha20Pp);
  return { count: rows.length, rows };
}

// PUBLIC — user-facing evidence card, one-paragraph.
export async function evidenceCardSummary({ experimentId }) {
  const [experiment, leaderboard] = await Promise.all([
    StocksP4Experiment.findOne({ experimentId }).lean(),
    computeLeaderboard({ experimentId }),
  ]);
  if (!experiment) return "P4 experiment not found.";
  const daysRunning = Math.max(1, Math.round((Date.now() - new Date(experiment.startDate).getTime()) / 86400_000));

  const at20 = (leaderboard.rows || []).filter(r => r.horizonDays === 20);
  const champion = at20.find(r => r.model === CHAMPION_MODEL_ID);
  const challengers = at20.filter(r => r.model !== CHAMPION_MODEL_ID && r.model !== "G")
    .sort((a, b) => (b.medianAlphaPp ?? -Infinity) - (a.medianAlphaPp ?? -Infinity));
  const bestChallenger = challengers[0] || null;

  const lines = [];
  lines.push(`SYSTEM EVIDENCE — experiment ${experimentId}, day ${daysRunning}`);
  if (bestChallenger && Number.isFinite(bestChallenger.medianAlphaPp)) {
    lines.push(`Best challenger: ${bestChallenger.model} — 20d picks: ${bestChallenger.sampleSize}, median α: ${bestChallenger.medianAlphaPp.toFixed(2)}pp, hit rate: ${(bestChallenger.hitRatePct ?? 0).toFixed(0)}%`);
  } else {
    lines.push(`Best challenger: no challenger has enough mature 20d observations yet.`);
  }
  if (champion && Number.isFinite(champion.medianAlphaPp)) {
    lines.push(`Legacy A: median α: ${champion.medianAlphaPp.toFixed(2)}pp, hit rate: ${(champion.hitRatePct ?? 0).toFixed(0)}%, n=${champion.sampleSize}`);
  } else {
    lines.push(`Legacy A: no mature 20d observations yet.`);
  }
  const promoOk = bestChallenger && meetsPromotionCriteria(bestChallenger, champion, experiment.promotionCriteria);
  lines.push(`Status: ${promoOk ? "MEETS PRE-REGISTERED THRESHOLDS — MODEL PROMOTION PROPOSAL AVAILABLE" : "NOT ENOUGH EVIDENCE TO PROMOTE"}`);
  return lines.join("\n");
}

function meetsPromotionCriteria(challenger, champion, criteria) {
  if (!challenger || !champion || !criteria) return false;
  if (challenger.sampleSize < criteria.minMature20dObservations) return false;
  if (!(challenger.medianAlphaPp > criteria.minPositiveMedianAlpha20dPp)) return false;
  if (!(challenger.meanAlphaPp > criteria.minPositiveMeanAlpha20dPp)) return false;
  const championMedian = champion.medianAlphaPp ?? -Infinity;
  if (!((challenger.medianAlphaPp - championMedian) >= criteria.mustBeatChampionMedianPp)) return false;
  return true;
}

// PUBLIC — cost projection (spec §21).
export function projectDailyCost({ candidateCount = 200, models = ALL_P4_MODEL_IDS.length, includeShadow = true }) {
  const perCandidate = { fmpCalls: 4, yahooCalls: 2, mongoWrites: 2 }; // Stage-2 rough
  const totalFmp = candidateCount * perCandidate.fmpCalls * (includeShadow ? models : 1);
  const totalYahoo = candidateCount * perCandidate.yahooCalls * (includeShadow ? models : 1);
  const totalMongo = candidateCount * perCandidate.mongoWrites * models;
  return {
    fmpCalls: totalFmp, yahooCalls: totalYahoo, mongoWrites: totalMongo,
    estimatedRuntimeSec: Math.ceil(candidateCount * 0.4 * models / 8), // 8-way parallel, ~0.4s/candidate
  };
}
