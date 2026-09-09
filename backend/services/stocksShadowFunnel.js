// backend/services/stocksShadowFunnel.js
//
// P2.6 (2026-09-09) — env-gated wide-funnel shadow experiment.
//
// P2 raised the ceiling on MULTI_FACTOR_TOP_K (30 → 150) and P2.5
// captured a Stage-1-only shadow of positions 30–150 (technical rank
// only). This module actually RUNS Stage-2 scoring on the wider
// slice on the SAME market snapshot, so we can answer whether
// candidates at Stage-1 rank 31–150 subsequently produce high
// Opportunity Quality once we examine their real fundamentals /
// revisions / drift.
//
// Contract:
//   • Runs ONLY when env `STOCKS_SHADOW_FUNNEL_WIDTHS` is set to a
//     comma-separated list like "medium" or "medium,wide".
//   • Executes a full Stage-2-equivalent scoring pass on each width
//     using the SAME `scored` array the production run consumed, so
//     PIT correctness holds — no future prices, no future fundamentals.
//   • Persists per-candidate results to StocksShadowFunnelRun keyed
//     on (pickDate, funnel, ticker). Idempotent.
//   • Never affects production picks. Never blocks the pick engine
//     — a shadow failure is logged and shrugged off.
//
// Cost gate: the fixture we run per candidate mirrors the production
// Stage-2 fetches (fundamentals + growth + revisions + insider + RS
// + real EPS revisions + earnings surprise + industry strength). Ops
// should schedule this weekly, not every tick — the intent is
// experimental evidence, not a production widening.

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { getRealEpsRevisions, realEpsRevisionsToSubScore } from "./stocksRealEpsRevisions.js";
import { getEarningsSurpriseAndDrift, driftToSubScore } from "./stocksEarningsSurprise.js";
import { getIndustryStrength } from "./stocksIndustryStrength.js";
import { computeOpportunityScore } from "./stocksOpportunityScore.js";
import { computeEntryScore, combineOqEq, classifyOqEqTier, deriveEntrySubScoresFromTech } from "./stocksEntryScore.js";
import { ALL_MODEL_IDS, CHAMPION_MODEL_ID } from "./stocksScoringModels.js";
import StocksShadowFunnelRun from "../models/StocksShadowFunnelRun.js";
import StocksShadowFunnelExperiment from "../models/StocksShadowFunnelExperiment.js";

const FUNNEL_WIDTHS = {
  narrow: { stage1: 30, rescue: 15 },
  medium: { stage1: 75, rescue: 30 },
  wide:   { stage1: 150, rescue: 75 },
};

// PUBLIC — read env into an array of widths to run. Returns [] when
// the experiment is disabled. Invalid entries are silently dropped
// with a warning; misspelling a width shouldn't run the wrong one.
export function requestedShadowWidths() {
  const raw = String(process.env.STOCKS_SHADOW_FUNNEL_WIDTHS || "").trim();
  if (!raw) return [];
  const parts = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = [];
  for (const p of parts) {
    if (FUNNEL_WIDTHS[p]) valid.push(p);
    else console.warn(`[shadow-funnel] unknown width "${p}" — expected one of narrow|medium|wide`);
  }
  return valid;
}

// PUBLIC — run a shadow width. `scored` is the Stage-1 output the
// production pick engine already computed (with `tech` retained on
// each candidate). `deps` = { getFundamentals, getGrowth,
// getEstimateRevisions, spyBars, xicBars, computeMultiFactorScore,
// computeRelativeStrengthFromBars, insiderByBase, sectorRotation,
// engineVersion, email }.
//
// Returns the array of shadow-scored candidates for that width.
export async function runShadowFunnelWidth(width, scored, deps = {}) {
  const cfg = FUNNEL_WIDTHS[width];
  if (!cfg) return [];
  const stage1 = (scored || []).slice(0, cfg.stage1);
  if (stage1.length === 0) return [];
  const pickDate = new Date().toISOString().slice(0, 10);

  // P3 durability — mark experiment PENDING → RUNNING before doing
  // any work so a mid-flight crash is visible in ExperimentTracker.
  // Attempt count auto-increments if a prior attempt reached a
  // terminal state (COMPLETE / FAILED).
  let attempt = 1;
  try {
    const prior = await StocksShadowFunnelExperiment.findOne({ pickDate, funnel: width }).sort({ attempt: -1 }).lean();
    if (prior && (prior.status === "COMPLETE" || prior.status === "FAILED")) attempt = (prior.attempt || 1) + 1;
  } catch { /* soft-fail */ }
  const experimentKey = { pickDate, funnel: width, attempt };
  try {
    await StocksShadowFunnelExperiment.updateOne(experimentKey, {
      $set: {
        ...experimentKey,
        status: "RUNNING",
        startedAt: new Date(),
        candidateCount: stage1.length,
        scoredCount: 0,
        errorMessage: null,
        engineVersion: deps.engineVersion || null,
        trigger: deps.trigger || "engine",
      },
    }, { upsert: true });
  } catch (e) {
    console.warn(`[shadow-funnel] experiment tracker upsert failed (${width}):`, e?.message);
  }

  const { getFundamentals, getGrowth, getEstimateRevisions,
          computeMultiFactorScore, computeRelativeStrengthFromBars,
          spyBars, xicBars, insiderByBase = new Map(),
          sectorRotation = null, engineVersion = "2.2.0" } = deps;

  const results = [];
  const CONC = 5;
  let hardFail = null;
  try {
  for (let i = 0; i < stage1.length; i += CONC) {
    const slice = stage1.slice(i, i + CONC);
    await Promise.all(slice.map(async (cand) => {
      try {
        const ccy = cand.currency || "USD";
        const bench = ccy === "CAD" ? xicBars : spyBars;
        const [tickerBars, fundamentals, growth, revisions, realEpsRev, surprise] = await Promise.all([
          fetchYahooDaily(cand.ticker, "1y").catch(() => null),
          getFundamentals(cand.ticker, ccy).catch(() => null),
          getGrowth(cand.ticker).catch(() => null),
          getEstimateRevisions(cand.ticker).catch(() => null),
          getRealEpsRevisions(cand.ticker).catch(() => ({ ok: false })),
          getEarningsSurpriseAndDrift(cand.ticker, {
            benchmarkTicker: ccy === "CAD" ? "XIC.TO" : "SPY",
          }).catch(() => ({ ok: false })),
        ]);
        const rs = (tickerBars && bench) ? computeRelativeStrengthFromBars(tickerBars, bench) : { ok: false };
        const base = String(cand.ticker).replace(/\..*$/, "");
        const insider = insiderByBase.get(base) || null;
        const composite = computeMultiFactorScore({
          technicalScore: cand.deterministicScore,
          fundamentals, growth, revisions, rs, insider,
        });
        const industryStrength = await getIndustryStrength(cand.ticker, {
          fundamentals,
          benchmarkTicker: ccy === "CAD" ? "XIC.TO" : "SPY",
          sectorRotation,
        }).catch(() => ({ score: null, source: "unavailable" }));
        const realRevSub = realEpsRevisionsToSubScore(realEpsRev);
        const driftSub = driftToSubScore(surprise);
        const oqInput = {
          fundamentalsScore: composite.factors?.fundamentals?.score ?? null,
          growthScore: composite.factors?.growth?.score ?? null,
          revisionsScore: realRevSub != null ? realRevSub : (composite.factors?.estimate_revisions?.score ?? null),
          relativeStrengthScore: composite.factors?.relative_strength?.score ?? null,
          insiderScore: composite.factors?.insider?.score ?? null,
          industryStrengthScore: industryStrength?.score ?? null,
          priceTargetContextScore: composite.factors?.estimate_revisions?.score ?? null,
          postEarningsDriftScore: driftSub,
          catalystQualityScore: null,
          revisionsMeta: {
            hasReal4wBaseline: !!(realEpsRev?.ok && realEpsRev?.hasReal4wBaseline),
          },
          industryStrengthMeta: { source: industryStrength?.source || "unavailable" },
        };
        const entrySubs = deriveEntrySubScoresFromTech(cand.tech || null);
        const scoreByModel = {};
        for (const id of ALL_MODEL_IDS) {
          const oq = computeOpportunityScore(oqInput, id);
          const eq = computeEntryScore(entrySubs, id, { derivedFromTech: true });
          scoreByModel[id] = {
            opportunity: oq.score,
            entry: eq.score,
            combined: combineOqEq(oq.score, eq.score, id),
            status: oq.status || "OK",
            factorCoveragePct: oq.factorCoveragePct ?? null,
          };
        }
        const champion = scoreByModel[CHAMPION_MODEL_ID];
        const row = {
          pickDate, funnel: width, ticker: cand.ticker,
          rank: i + 1, // pre-sort rank; a downstream analytical script re-ranks
          technicalScore: Number.isFinite(cand.deterministicScore) ? cand.deterministicScore : null,
          compositeRank: composite.score,
          opportunityScore: champion?.opportunity ?? null,
          entryScore: champion?.entry ?? null,
          combined: champion?.combined ?? null,
          scoreByModel,
          qualified: false, // filled after re-rank below
          disqualifyReason: null,
          priceAtScore: Number.isFinite(cand.entryPrice) ? cand.entryPrice
                         : (Number.isFinite(cand.tech?.last) ? cand.tech.last : null),
          dataAsOf: new Date(),
          engineVersion,
        };
        results.push(row);
      } catch (e) {
        console.warn(`[shadow-funnel] ${width} ${cand.ticker} skipped:`, e?.message);
      }
    }));
  }
  } catch (e) {
    // P3 — outer failure surfaces via experiment tracker so a crash
    // never looks like a clean completion.
    hardFail = e?.message || String(e);
    console.warn(`[shadow-funnel] ${width} hard failure during scoring:`, hardFail);
    try {
      await StocksShadowFunnelExperiment.updateOne(experimentKey, {
        $set: { status: "FAILED", completedAt: new Date(),
                scoredCount: results.length, errorMessage: hardFail },
      });
    } catch { /* soft-fail */ }
    return results; // partial results still persisted below? Return early instead.
  }
  // Re-rank by champion combined descending.
  results.sort((a, b) => (b.combined ?? -1) - (a.combined ?? -1));
  results.forEach((r, i) => { r.rank = i + 1; });

  // Persist (idempotent upsert per (pickDate, funnel, ticker)).
  const ops = results.map(r => ({
    updateOne: {
      filter: { pickDate: r.pickDate, funnel: r.funnel, ticker: r.ticker },
      update: { $set: { ...r, runStatus: "COMPLETE", runCompletedAt: new Date() } },
      upsert: true,
    },
  }));
  let terminal = "COMPLETE";
  let errMsg = null;
  try {
    if (ops.length > 0) await StocksShadowFunnelRun.bulkWrite(ops, { ordered: false });
  } catch (e) {
    terminal = "FAILED";
    errMsg = e?.message || "persist failed";
    console.warn(`[shadow-funnel] persist failed (${width}):`, errMsg);
  }
  try {
    await StocksShadowFunnelExperiment.updateOne(experimentKey, {
      $set: {
        status: terminal,
        completedAt: new Date(),
        scoredCount: results.length,
        errorMessage: errMsg,
      },
    });
  } catch { /* soft-fail */ }
  console.log(`[shadow-funnel] ${width}: scored ${results.length} candidates → ${terminal}`);
  return results;
}

// PUBLIC — run any/all requested widths sequentially so we don't
// contend with production API budget.
export async function runShadowFunnels(scored, deps = {}) {
  const widths = requestedShadowWidths();
  if (widths.length === 0) return { widthsRun: [] };
  const out = { widthsRun: [] };
  for (const w of widths) {
    const rows = await runShadowFunnelWidth(w, scored, deps);
    out.widthsRun.push({ width: w, candidateCount: rows.length });
  }
  return out;
}
