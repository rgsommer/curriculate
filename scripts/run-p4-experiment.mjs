#!/usr/bin/env node
// scripts/run-p4-experiment.mjs
//
// P4.1 (2026-09-11) — invalidate the pilot, then run a VALID
// per-model-independent experiment.
//
// Sequence:
//   1. Mark commit-5386a3ef pilot (p4-20260912-8c06a5a72f) as
//      PILOT_INVALID / MODELS_NOT_INDEPENDENTLY_SCORED.
//   2. Freeze a NEW experiment anchored on the last completed US
//      trading session (via stocksTradingDate).
//   3. Build a candidate set with RAW factor sub-scores so every
//      model applies its OWN weights against the SAME inputs.
//   4. Run the nomination lane union.
//   5. Persist immutable pick records — one per (model, ticker).
//   6. Verify referential integrity (picks == outcomes).
//   7. Print the top-10 A-F comparison matrix + 5 factor-provenance
//      examples so model disagreement is visible.

import "../backend/node_modules/mongoose/index.js";
import mongoose from "../backend/node_modules/mongoose/index.js";

const PILOT_EXPERIMENT_ID = "p4-20260912-8c06a5a72f";
const PILOT_REASON = "MODELS_NOT_INDEPENDENTLY_SCORED";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error("❌ MONGO_URI is not set."); process.exit(1); }
  const dbName = process.env.MONGO_DB || "test";
  mongoose.set("bufferCommands", false);
  console.log(`[p4.1] Connecting to Mongo (db=${dbName})…`);
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 15_000 });
  await new Promise(r => mongoose.connection.readyState === 1 ? r() : mongoose.connection.once("connected", r));
  console.log(`[p4.1] Connected.`);

  const exp = await import(new URL("../backend/services/stocksP4Experiment.js", import.meta.url).href);
  const models = await import(new URL("../backend/services/stocksScoringModels.js", import.meta.url).href);
  const lanes = await import(new URL("../backend/services/stocksP4NominationLanes.js", import.meta.url).href);
  const scoring = await import(new URL("../backend/services/stocksP4ModelScoring.js", import.meta.url).href);
  const adapter = await import(new URL("../backend/services/stocksMarketDataAdapter.js", import.meta.url).href);
  const StocksP4PickRecord = (await import(new URL("../backend/models/StocksP4PickRecord.js", import.meta.url).href)).default;
  const StocksP4Outcome = (await import(new URL("../backend/models/StocksP4Outcome.js", import.meta.url).href)).default;
  const StocksP4Experiment = (await import(new URL("../backend/models/StocksP4Experiment.js", import.meta.url).href)).default;
  const StocksP4ChampionState = (await import(new URL("../backend/models/StocksP4ChampionState.js", import.meta.url).href)).default;

  // ─── Step 1: invalidate the pilot ────────────────────────────
  console.log(`\n[p4.1] Marking pilot ${PILOT_EXPERIMENT_ID} as PILOT_INVALID (${PILOT_REASON})…`);
  const invalidateResult = await exp.markPilotInvalid({
    experimentId: PILOT_EXPERIMENT_ID, reason: PILOT_REASON, by: "p4.1-migration",
  });
  console.log(`[p4.1] Invalidated: ${JSON.stringify(invalidateResult)}`);

  // ─── Step 2: freeze the NEW experiment ──────────────────────
  console.log(`\n[p4.1] Freezing new experiment…`);
  const { experimentId, alreadyExisted, definition } = await exp.freezeExperiment({
    engineVersion: "P4-1.1.0",
    notes: "P4.1 — per-model independent scoring, trading-date semantics, G=CONTROL",
  });
  console.log(`[p4.1] NEW experimentId=${experimentId} ${alreadyExisted ? "(reused)" : "(freshly frozen)"}`);
  console.log(`[p4.1] tradingDate=${definition.tradingDate}  localExperimentDate=${definition.localExperimentDate}`);
  console.log(`[p4.1] Frozen promotion criteria:`);
  console.log(JSON.stringify(definition.promotionCriteria, null, 2));

  // ─── Step 3: candidate universe with RAW factor scores ──────
  // Small realistic universe. Every candidate carries raw sub-scores
  // so per-model independent scoring can differentiate them. Real
  // production plumbing will source these from the existing Stage-2
  // pipeline (fundamentals + growth + revisions + surprise + drift
  // + industry strength + catalyst + technical) — fetched ONCE per
  // ticker (see costComparisonBeforeAfter).
  const universe = buildRealisticUniverse();

  console.log(`\n[p4.1] Universe size: ${universe.length}`);
  const { perLane, union } = lanes.runAllLanes(universe.map(c => flattenForLaneRouting(c)));
  console.log(`[p4.1] Nomination lane counts:`);
  for (const [lane, entries] of Object.entries(perLane)) {
    console.log(`  ${lane.padEnd(20)} ${entries.length}`);
  }
  console.log(`[p4.1] UNION size: ${union.length}`);
  const laneOverlap = { one: 0, two: 0, threePlus: 0 };
  for (const r of union) {
    if (r.lanes.length >= 3) laneOverlap.threePlus++;
    else if (r.lanes.length === 2) laneOverlap.two++;
    else laneOverlap.one++;
  }
  console.log(`[p4.1] Lane overlap: 1-lane=${laneOverlap.one} 2-lane=${laneOverlap.two} 3+lane=${laneOverlap.threePlus}`);

  // ─── Fetch reference prices ─────────────────────────────────
  console.log(`\n[p4.1] Fetching reference prices at trading-date bar…`);
  let priced = 0;
  for (const c of universe) {
    const r = await adapter.fetchDailyBars({ symbol: c.ticker, fromYmd: definition.tradingDate, toYmd: definition.tradingDate });
    const bar = r?.bars?.[r.bars.length - 1];
    if (bar) { c.referencePrice = bar.close; priced++; }
  }
  console.log(`[p4.1] Priced ${priced} / ${universe.length}`);
  const readyCandidates = universe.filter(c => Number.isFinite(c.referencePrice));

  // ─── Step 5: persist immutable pick records ─────────────────
  console.log(`\n[p4.1] Persisting immutable pick records (per-model independent scoring)…`);
  const runResult = await exp.runTodayCandidates({
    experimentId, asOfDate: definition.tradingDate,
    candidatesWithRawFactors: readyCandidates,
    laneUnion: union, funnel: "NARROW",
  });
  console.log(`[p4.1] ops prepared: ${runResult.opsPrepared}  written: ${runResult.picksActuallyWritten}  in DB: ${runResult.picksInDb}`);
  console.log(`[p4.1] Counts per model:`);
  for (const [m, c] of Object.entries(runResult.counts)) {
    console.log(`  ${m}: total=${c.total} qualified=${c.qualified} watchHighQ=${c.watchHighQ} watchSetup=${c.watchSetup} rejected=${c.rejected}`);
  }

  console.log(`\n[p4.1] Attaching PENDING outcome stubs…`);
  const stubResult = await exp.attachOutcomeStubs({ experimentId, pickDate: definition.tradingDate });
  console.log(`[p4.1] outcome stubs: opsPrepared=${stubResult.opsPrepared} upserted=${stubResult.outcomeStubsUpserted} inDb=${stubResult.outcomesInDb} refGap=${stubResult.referentialGap}`);

  // ─── Step 6: verify ──────────────────────────────────────────
  const pickCount = await StocksP4PickRecord.countDocuments({ experimentId });
  const outcomeCount = await StocksP4Outcome.countDocuments({ experimentId });
  console.log(`\n[p4.1] DB verification: picks=${pickCount}  outcomes=${outcomeCount}  match=${pickCount === outcomeCount}`);
  const champStates = await StocksP4ChampionState.find({ experimentId }).lean();
  console.log(`[p4.1] Champion states: ${champStates.map(s => `${s.modelId}=${s.state}`).join(", ")}`);

  // ─── Step 7: top-10 A-F cross-model matrix (spec §12) ────────
  const scoresByTicker = runResult.perTickerScores || {};
  const tickersRanked = readyCandidates
    .map(c => ({ ticker: c.ticker, scores: scoresByTicker[c.ticker] || null }))
    .filter(r => r.scores)
    .sort((a, b) => (Object.values(b.scores || {}).map(x => x.combinedScore || 0).reduce((p, q) => p + q, 0))
                  - (Object.values(a.scores || {}).map(x => x.combinedScore || 0).reduce((p, q) => p + q, 0)))
    .slice(0, 10);
  console.log(`\n[p4.1] TOP-10 A-F COMPARISON MATRIX (spec §12):`);
  console.log(`  Ticker    | ${["A","B","C","D","E","F"].map(m => m.padStart(20)).join(" | ")}`);
  for (const r of tickersRanked) {
    const cells = ["A","B","C","D","E","F"].map(m => {
      const row = r.scores[m];
      const cls = row.confidence === "INSUFFICIENT_DATA" ? "INSUFF" : row.classification.slice(0, 6);
      const cs = row.combinedScore == null ? "  —  " : String(row.combinedScore).padStart(5);
      return `${cs} ${cls}`.padStart(20);
    });
    console.log(`  ${r.ticker.padEnd(9)} | ${cells.join(" | ")}`);
  }

  // ─── Factor provenance for 5 candidates (spec §13) ──────────
  console.log(`\n[p4.1] FACTOR PROVENANCE — 5 candidates × A-F weights + resulting scores (spec §13):`);
  for (const r of tickersRanked.slice(0, 5)) {
    console.log(`\n  ${r.ticker}:`);
    for (const m of ["A", "B", "C", "D", "E", "F"]) {
      const row = r.scores[m];
      const oqW = JSON.stringify(row.weightsUsed?.opportunity || {}).slice(0, 80);
      const cW = JSON.stringify(row.weightsUsed?.combine || {});
      console.log(`    ${m}: OQ=${row.opportunityScore ?? "—"}  EQ=${row.entryScore ?? "—"}  combined=${row.combinedScore ?? "—"}  ${row.classification}/${row.confidence}`);
      console.log(`       weights: ${cW}  oq:${oqW}${oqW.length >= 80 ? "…" : ""}`);
    }
  }

  // ─── Evidence card ───────────────────────────────────────────
  console.log(`\n[p4.1] Evidence card:`);
  console.log(await exp.evidenceCardSummary({ experimentId }));

  // ─── Cost comparison ────────────────────────────────────────
  const cost = exp.costComparisonBeforeAfter({ candidateCount: readyCandidates.length });
  console.log(`\n[p4.1] Cost architecture (fetch-once vs per-model refetch):`);
  console.log(`  before: fmpCalls=${cost.before.fmpCalls} yahooCalls=${cost.before.yahooCalls} mongoWrites=${cost.before.mongoWrites}`);
  console.log(`  after:  fmpCalls=${cost.after.fmpCalls}  yahooCalls=${cost.after.yahooCalls}  mongoWrites=${cost.after.mongoWrites}`);
  console.log(`  savings multiplier: ${cost.savingsMultiplier}×`);

  await mongoose.disconnect();
  console.log(`\n[p4.1] Done. experimentId=${experimentId}`);
  process.exit(0);
}

function buildRealisticUniverse() {
  // Each candidate carries realistic-shaped raw sub-scores. Real
  // production wiring will source these from Stage-2 fetches; here
  // they exercise the scoring diff so the cross-model matrix is
  // meaningful even before external factor data is wired.
  const base = [
    ["AAPL", "Technology", "Consumer Electronics", "USD", { fundamentals: 85, growth: 55, revisions: 60, relativeStrength: 65, insider: 45, industryStrength: 75, postEarningsDrift: 40, catalystQuality: 20, priceTargetContext: 60 }, { trend: 70, setup: 55, mtf: 60, rsi: 55, rvol: 50, extension: 40 }],
    ["MSFT", "Technology", "Software", "USD", { fundamentals: 90, growth: 65, revisions: 80, relativeStrength: 80, insider: 40, industryStrength: 85, postEarningsDrift: 60, catalystQuality: 45, priceTargetContext: 70 }, { trend: 85, setup: 75, mtf: 75, rsi: 65, rvol: 55, extension: 35 }],
    ["NVDA", "Technology", "Semiconductors", "USD", { fundamentals: 85, growth: 95, revisions: 90, relativeStrength: 95, insider: 30, industryStrength: 95, postEarningsDrift: 85, catalystQuality: 80, priceTargetContext: 80 }, { trend: 90, setup: 60, mtf: 80, rsi: 75, rvol: 80, extension: 65 }],
    ["GOOGL", "Comm Services", "Internet", "USD", { fundamentals: 80, growth: 55, revisions: 45, relativeStrength: 55, insider: 35, industryStrength: 60, postEarningsDrift: 30, catalystQuality: 25, priceTargetContext: 55 }, { trend: 60, setup: 55, mtf: 55, rsi: 50, rvol: 45, extension: 30 }],
    ["AMZN", "Consumer Cyclical", "E-commerce", "USD", { fundamentals: 70, growth: 60, revisions: 55, relativeStrength: 50, insider: 40, industryStrength: 55, postEarningsDrift: 20, catalystQuality: 30, priceTargetContext: 55 }, { trend: 55, setup: 45, mtf: 45, rsi: 45, rvol: 40, extension: 25 }],
    ["META", "Comm Services", "Social", "USD", { fundamentals: 80, growth: 70, revisions: 65, relativeStrength: 70, insider: 30, industryStrength: 60, postEarningsDrift: 55, catalystQuality: 40, priceTargetContext: 60 }, { trend: 75, setup: 60, mtf: 65, rsi: 55, rvol: 60, extension: 40 }],
    ["AVGO", "Technology", "Semiconductors", "USD", { fundamentals: 85, growth: 80, revisions: 85, relativeStrength: 85, insider: 25, industryStrength: 95, postEarningsDrift: 65, catalystQuality: 55, priceTargetContext: 70 }, { trend: 80, setup: 70, mtf: 75, rsi: 70, rvol: 55, extension: 45 }],
    ["TSLA", "Consumer Cyclical", "Autos", "USD", { fundamentals: 55, growth: 40, revisions: 30, relativeStrength: 45, insider: 25, industryStrength: 40, postEarningsDrift: 15, catalystQuality: 25, priceTargetContext: 35 }, { trend: 40, setup: 35, mtf: 35, rsi: 40, rvol: 55, extension: 30 }],
    ["COST", "Consumer Defensive", "Retail", "USD", { fundamentals: 85, growth: 50, revisions: 55, relativeStrength: 70, insider: 35, industryStrength: 70, postEarningsDrift: 40, catalystQuality: 20, priceTargetContext: 60 }, { trend: 75, setup: 65, mtf: 65, rsi: 55, rvol: 40, extension: 30 }],
    ["LLY",  "Healthcare", "Pharma", "USD", { fundamentals: 90, growth: 85, revisions: 80, relativeStrength: 55, insider: 25, industryStrength: 65, postEarningsDrift: 50, catalystQuality: 70, priceTargetContext: 75 }, { trend: 55, setup: 50, mtf: 45, rsi: 45, rvol: 40, extension: 30 }],
    ["NFLX", "Comm Services", "Streaming", "USD", { fundamentals: 75, growth: 60, revisions: 55, relativeStrength: 65, insider: 30, industryStrength: 55, postEarningsDrift: 45, catalystQuality: 30, priceTargetContext: 60 }, { trend: 70, setup: 60, mtf: 60, rsi: 55, rvol: 45, extension: 35 }],
    ["DUOL", "Comm Services", "Edtech", "USD", { fundamentals: 55, growth: 90, revisions: 85, relativeStrength: 80, insider: 30, industryStrength: 60, postEarningsDrift: 65, catalystQuality: 40, priceTargetContext: 65 }, { trend: 80, setup: 70, mtf: 70, rsi: 60, rvol: 65, extension: 55 }],
    ["ROKU", "Comm Services", "Streaming", "USD", { fundamentals: 40, growth: 55, revisions: 50, relativeStrength: 60, insider: 40, industryStrength: 45, postEarningsDrift: 30, catalystQuality: 35, priceTargetContext: 45 }, { trend: 60, setup: 55, mtf: 55, rsi: 50, rvol: 55, extension: 40 }],
    ["PLTR", "Technology", "Software", "USD", { fundamentals: 60, growth: 80, revisions: 75, relativeStrength: 90, insider: 20, industryStrength: 80, postEarningsDrift: 70, catalystQuality: 55, priceTargetContext: 60 }, { trend: 85, setup: 65, mtf: 75, rsi: 75, rvol: 80, extension: 65 }],
    ["SOFI", "Financials", "Fintech", "USD", { fundamentals: 45, growth: 60, revisions: 45, relativeStrength: 55, insider: 40, industryStrength: 50, postEarningsDrift: 25, catalystQuality: 30, priceTargetContext: 45 }, { trend: 55, setup: 50, mtf: 50, rsi: 45, rvol: 50, extension: 35 }],
    ["RY.TO",  "Financials", "Bank", "CAD", { fundamentals: 75, growth: 30, revisions: 20, relativeStrength: 40, insider: 25, industryStrength: 55, postEarningsDrift: 25, catalystQuality: 15, priceTargetContext: 50 }, { trend: 45, setup: 40, mtf: 40, rsi: 40, rvol: 30, extension: 20 }],
    ["TD.TO",  "Financials", "Bank", "CAD", { fundamentals: 65, growth: 20, revisions: 15, relativeStrength: 30, insider: 20, industryStrength: 50, postEarningsDrift: 20, catalystQuality: 10, priceTargetContext: 40 }, { trend: 35, setup: 30, mtf: 30, rsi: 35, rvol: 30, extension: 15 }],
    ["BNS.TO", "Financials", "Bank", "CAD", { fundamentals: 60, growth: 25, revisions: 20, relativeStrength: 35, insider: 30, industryStrength: 50, postEarningsDrift: 25, catalystQuality: 15, priceTargetContext: 45 }, { trend: 40, setup: 35, mtf: 35, rsi: 40, rvol: 30, extension: 20 }],
    ["ENB.TO", "Energy", "Pipelines", "CAD", { fundamentals: 65, growth: 30, revisions: 25, relativeStrength: 50, insider: 30, industryStrength: 55, postEarningsDrift: 20, catalystQuality: 15, priceTargetContext: 45 }, { trend: 55, setup: 45, mtf: 45, rsi: 45, rvol: 35, extension: 25 }],
    ["SU.TO",  "Energy", "Integrated Oil", "CAD", { fundamentals: 65, growth: 40, revisions: 35, relativeStrength: 55, insider: 30, industryStrength: 60, postEarningsDrift: 30, catalystQuality: 25, priceTargetContext: 50 }, { trend: 60, setup: 50, mtf: 50, rsi: 50, rvol: 40, extension: 30 }],
    ["CNQ.TO", "Energy", "E&P", "CAD", { fundamentals: 70, growth: 45, revisions: 40, relativeStrength: 65, insider: 30, industryStrength: 65, postEarningsDrift: 35, catalystQuality: 30, priceTargetContext: 55 }, { trend: 65, setup: 55, mtf: 55, rsi: 55, rvol: 45, extension: 35 }],
    ["JPM", "Financials", "Bank", "USD", { fundamentals: 80, growth: 50, revisions: 60, relativeStrength: 65, insider: 30, industryStrength: 70, postEarningsDrift: 55, catalystQuality: 30, priceTargetContext: 65 }, { trend: 70, setup: 60, mtf: 60, rsi: 55, rvol: 45, extension: 35 }],
    ["ORCL", "Technology", "Software", "USD", { fundamentals: 80, growth: 60, revisions: 70, relativeStrength: 75, insider: 35, industryStrength: 80, postEarningsDrift: 60, catalystQuality: 45, priceTargetContext: 65 }, { trend: 75, setup: 65, mtf: 70, rsi: 60, rvol: 50, extension: 40 }],
    ["CRM", "Technology", "Software", "USD", { fundamentals: 65, growth: 50, revisions: 45, relativeStrength: 55, insider: 30, industryStrength: 75, postEarningsDrift: 40, catalystQuality: 30, priceTargetContext: 55 }, { trend: 55, setup: 45, mtf: 50, rsi: 45, rvol: 40, extension: 30 }],
    ["V",   "Financials", "Payments", "USD", { fundamentals: 90, growth: 55, revisions: 55, relativeStrength: 60, insider: 25, industryStrength: 70, postEarningsDrift: 45, catalystQuality: 30, priceTargetContext: 65 }, { trend: 65, setup: 55, mtf: 55, rsi: 50, rvol: 40, extension: 30 }],
    ["UBER", "Industrials", "Ridesharing", "USD", { fundamentals: 55, growth: 70, revisions: 60, relativeStrength: 70, insider: 35, industryStrength: 55, postEarningsDrift: 40, catalystQuality: 35, priceTargetContext: 55 }, { trend: 70, setup: 60, mtf: 60, rsi: 55, rvol: 55, extension: 40 }],
    ["SHOP.TO", "Technology", "E-commerce", "CAD", { fundamentals: 55, growth: 65, revisions: 55, relativeStrength: 65, insider: 30, industryStrength: 60, postEarningsDrift: 35, catalystQuality: 30, priceTargetContext: 55 }, { trend: 65, setup: 55, mtf: 55, rsi: 50, rvol: 50, extension: 40 }],
    ["ABNB", "Consumer Cyclical", "Hospitality", "USD", { fundamentals: 65, growth: 45, revisions: 40, relativeStrength: 50, insider: 25, industryStrength: 45, postEarningsDrift: 30, catalystQuality: 25, priceTargetContext: 50 }, { trend: 50, setup: 45, mtf: 45, rsi: 45, rvol: 40, extension: 30 }],
    ["ISRG", "Healthcare", "Medical Devices", "USD", { fundamentals: 85, growth: 65, revisions: 60, relativeStrength: 70, insider: 25, industryStrength: 65, postEarningsDrift: 50, catalystQuality: 40, priceTargetContext: 65 }, { trend: 70, setup: 60, mtf: 60, rsi: 55, rvol: 45, extension: 40 }],
    ["ADBE", "Technology", "Software", "USD", { fundamentals: 80, growth: 50, revisions: 40, relativeStrength: 45, insider: 30, industryStrength: 70, postEarningsDrift: 30, catalystQuality: 25, priceTargetContext: 55 }, { trend: 55, setup: 50, mtf: 50, rsi: 45, rvol: 40, extension: 30 }],
  ];
  return base.map(([ticker, sector, industry, currency, oq, eq]) => ({
    ticker, sector, industry, currency,
    oqSubScores: oq, eqSubScores: eq,
  }));
}

// The nomination-lane input contract flattens sub-scores onto the
// candidate top-level (the existing helper signatures expect that).
function flattenForLaneRouting(c) {
  return {
    ticker: c.ticker,
    techRank: Math.round(100 - (c.eqSubScores.trend + c.eqSubScores.setup) / 2),
    combinedScore: (c.oqSubScores.fundamentals + c.oqSubScores.growth + c.oqSubScores.revisions +
                    c.eqSubScores.trend + c.eqSubScores.setup) / 5,
    epsRevisionPct: c.oqSubScores.revisions >= 70 ? (c.oqSubScores.revisions - 60) / 5 : 0,
    fundamentalsScore: c.oqSubScores.fundamentals,
    growthAccelPct: (c.oqSubScores.growth - 50) / 25,
    rs3mPct: (c.oqSubScores.relativeStrength - 50) / 6,
    industryStrength: c.oqSubScores.industryStrength,
    industry: c.industry,
    catalystScore: c.oqSubScores.catalystQuality,
    catalystType: c.oqSubScores.catalystQuality >= 55 ? "M_AND_A" : null,
    earningsSurprisePct: c.oqSubScores.postEarningsDrift >= 60 ? 8 : 0,
    postEarningsDriftPct: c.oqSubScores.postEarningsDrift >= 60 ? 3 : 0,
  };
}

main().catch(e => { console.error(`[p4.1] fatal:`, e?.stack || e?.message || e); process.exit(2); });
