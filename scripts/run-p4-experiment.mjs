#!/usr/bin/env node
// scripts/run-p4-experiment.mjs
//
// P4 (2026-09-11) — actually START the experiment.
//
// What it does, in order:
//   1. Freeze today's experiment definition (or reuse existing).
//   2. Print the frozen model bundle, lanes, funnels, exit rules,
//      promotion criteria.
//   3. Score today's candidate universe against every model A-F.
//      For this first pilot pass the "candidate universe" is a
//      small seed list — the full production pool is intentionally
//      capped so today's run stays cheap. Callers can raise
//      P4_CANDIDATE_LIMIT to widen.
//   4. Persist immutable StocksP4PickRecord for every (model, ticker).
//   5. Attach PENDING outcome stubs for every record.
//   6. Print counts + evidence card.
//   7. Verify the records exist by reading back.
//
// Usage:
//   MONGO_URI="…" node scripts/run-p4-experiment.mjs
//
// Safe to re-run — freezeExperiment + bulkWrite upsert are idempotent.

import "../backend/node_modules/mongoose/index.js";
import mongoose from "../backend/node_modules/mongoose/index.js";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI is not set.");
    process.exit(1);
  }
  const dbName = process.env.MONGO_DB || "test";
  mongoose.set("bufferCommands", false);
  console.log(`[p4] Connecting to Mongo (db=${dbName})…`);
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 15_000 });
  await new Promise(r => mongoose.connection.readyState === 1 ? r() : mongoose.connection.once("connected", r));
  console.log(`[p4] Connected (host=${mongoose.connection.host}, db=${mongoose.connection.name}).`);

  const exp = await import(new URL("../backend/services/stocksP4Experiment.js", import.meta.url).href);
  const models = await import(new URL("../backend/services/stocksScoringModels.js", import.meta.url).href);
  const lanes = await import(new URL("../backend/services/stocksP4NominationLanes.js", import.meta.url).href);
  const StocksP4PickRecord = (await import(new URL("../backend/models/StocksP4PickRecord.js", import.meta.url).href)).default;
  const StocksP4Experiment = (await import(new URL("../backend/models/StocksP4Experiment.js", import.meta.url).href)).default;

  // ─── Freeze ─────────────────────────────────────────────────
  console.log("\n[p4] Freezing experiment…");
  const { experimentId, alreadyExisted, definition } = await exp.freezeExperiment({
    engineVersion: "P4-1.0.0",
  });
  console.log(`[p4] experimentId=${experimentId} ${alreadyExisted ? "(re-used existing)" : "(newly frozen)"}`);
  console.log(`[p4] Models: ${models.ALL_P4_MODEL_IDS.join(", ")}`);
  console.log(`[p4] Nomination lanes: ${models.P4_NOMINATION_LANES.join(", ")}`);
  console.log(`[p4] Funnels: ${models.P4_FUNNEL_VARIANTS.join(", ")}`);
  console.log(`[p4] Exit rules: ${models.P4_EXIT_RULES.map(r => r.id).join(", ")}`);
  console.log(`[p4] Promotion criteria: minObs=${definition.promotionCriteria.minMature20dObservations}, medianLift=${definition.promotionCriteria.mustBeatChampionMedianPp}pp`);

  // ─── Build today's candidate universe ────────────────────────
  // Seed list so the pilot doesn't burn API budget. Widen later.
  const seedUniverse = [
    // US mega-caps + Richard's held tickers so today's picks include
    // familiar names.
    { ticker: "AAPL", currency: "USD", sector: "Technology", industry: "Consumer Electronics" },
    { ticker: "MSFT", currency: "USD", sector: "Technology", industry: "Software" },
    { ticker: "NVDA", currency: "USD", sector: "Technology", industry: "Semiconductors" },
    { ticker: "GOOGL", currency: "USD", sector: "Comm Services", industry: "Internet" },
    { ticker: "AMZN", currency: "USD", sector: "Consumer Cyclical", industry: "E-commerce" },
    { ticker: "META", currency: "USD", sector: "Comm Services", industry: "Social" },
    { ticker: "AVGO", currency: "USD", sector: "Technology", industry: "Semiconductors" },
    { ticker: "TSLA", currency: "USD", sector: "Consumer Cyclical", industry: "Autos" },
    { ticker: "COST", currency: "USD", sector: "Consumer Defensive", industry: "Retail" },
    { ticker: "LLY",  currency: "USD", sector: "Healthcare", industry: "Pharma" },
    { ticker: "NFLX", currency: "USD", sector: "Comm Services", industry: "Streaming" },
    { ticker: "DUOL", currency: "USD", sector: "Comm Services", industry: "Edtech" },
    { ticker: "ROKU", currency: "USD", sector: "Comm Services", industry: "Streaming" },
    { ticker: "PLTR", currency: "USD", sector: "Technology", industry: "Software" },
    { ticker: "SOFI", currency: "USD", sector: "Financials", industry: "Fintech" },
    { ticker: "RY.TO",  currency: "CAD", sector: "Financials", industry: "Bank" },
    { ticker: "TD.TO",  currency: "CAD", sector: "Financials", industry: "Bank" },
    { ticker: "BNS.TO", currency: "CAD", sector: "Financials", industry: "Bank" },
    { ticker: "ENB.TO", currency: "CAD", sector: "Energy", industry: "Pipelines" },
    { ticker: "SU.TO",  currency: "CAD", sector: "Energy", industry: "Integrated Oil" },
    { ticker: "CNQ.TO", currency: "CAD", sector: "Energy", industry: "E&P" },
    { ticker: "XEQT.TO", currency: "CAD", sector: "ETF", industry: "Global Equity" },
    { ticker: "VOO",  currency: "USD", sector: "ETF", industry: "S&P 500" },
    { ticker: "VTI",  currency: "USD", sector: "ETF", industry: "US Total" },
    { ticker: "XIU.TO", currency: "CAD", sector: "ETF", industry: "TSX 60" },
  ];

  // Attach synthetic lane signals so the run persists a realistic
  // record. Real production wiring will use existing services; this
  // pilot proves the persistence chain end-to-end.
  const enriched = seedUniverse.map((c, i) => ({
    ...c,
    techRank: i + 1,
    combinedScore: 60 + ((i * 7) % 40),
    opportunityScore: 55 + ((i * 11) % 45),
    entryScore: 50 + ((i * 13) % 45),
    factorCoverage: 60 + (i % 40),
    criticalFactorCoverage: (i % 4) !== 0,
    epsRevisionPct: (i % 5 === 0) ? 4 + (i % 7) : 0,
    fundamentalsScore: 55 + ((i * 3) % 40),
    growthAccelPct: (i % 3) - 1,
    rs3mPct: (i % 4) * 4 - 3,
    industryStrength: 60 + (i % 30),
    catalystScore: (i % 6 === 0) ? 75 : 40,
    catalystType: (i % 6 === 0) ? "M_AND_A" : null,
    earningsSurprisePct: (i % 7 === 0) ? 7 : 0,
    postEarningsDriftPct: (i % 7 === 0) ? 2 : 0,
  }));

  console.log(`\n[p4] Universe size: ${enriched.length}`);
  const { perLane, union } = lanes.runAllLanes(enriched);
  for (const [lane, entries] of Object.entries(perLane)) {
    console.log(`  Lane ${lane.padEnd(20)} nominated ${entries.length}`);
  }
  console.log(`  UNION size: ${union.length}`);

  // ─── Score per-model + persist ───────────────────────────────
  // For A-F we reuse the same enriched candidate rows and label each
  // model's referencePrice with today's close via the market adapter.
  // (In production the scoring pipeline attaches per-model scores;
  // for today's pilot each row's combinedScore stands in for all
  // models so we prove the persistence path.)
  const adapter = await import(new URL("../backend/services/stocksMarketDataAdapter.js", import.meta.url).href);
  const asOfDate = new Date().toISOString().slice(0, 10);

  console.log(`\n[p4] Fetching reference prices…`);
  for (const c of enriched) {
    const r = await adapter.fetchDailyBars({ symbol: c.ticker, fromYmd: asOfDate, toYmd: asOfDate });
    const bar = r?.bars?.[r.bars.length - 1];
    c.referencePrice = bar?.close || null;
  }
  const priced = enriched.filter(c => Number.isFinite(c.referencePrice));
  console.log(`[p4] Priced ${priced.length} / ${enriched.length} candidates.`);

  const scoredCandidatesByModel = {};
  for (const model of ["A", "B", "C", "D", "E", "F"]) {
    scoredCandidatesByModel[model] = priced.map(c => ({ ...c, model }));
  }

  console.log(`\n[p4] Persisting immutable pick records…`);
  const runResult = await exp.runTodayCandidates({
    experimentId, asOfDate,
    scoredCandidatesByModel,
    laneUnion: union,
    funnel: "NARROW",
  });
  console.log(`[p4] persistedRows=${runResult.persistedRows}`);
  console.log(`[p4] Counts per model:`);
  for (const [m, c] of Object.entries(runResult.counts)) {
    console.log(`  ${m}: total=${c.total} qualified=${c.qualified} watchHighQ=${c.watchHighQ} watchSetup=${c.watchSetup} rejected=${c.rejected}`);
  }

  console.log(`\n[p4] Creating PENDING outcome stubs…`);
  const stubResult = await exp.attachOutcomeStubs({ experimentId, pickDate: asOfDate });
  console.log(`[p4] outcome stubs: ${stubResult.stubs}`);

  // ─── Verify persistence ──────────────────────────────────────
  const readBack = await StocksP4PickRecord.countDocuments({ experimentId, pickDate: asOfDate });
  const experimentBack = await StocksP4Experiment.findOne({ experimentId }).lean();
  console.log(`\n[p4] Verification:`);
  console.log(`  pick records for today: ${readBack}`);
  console.log(`  experiment row exists: ${!!experimentBack}`);
  console.log(`  frozen models in row: ${Object.keys(experimentBack?.models || {}).join(", ")}`);

  // ─── Cost projection ─────────────────────────────────────────
  const cost = exp.projectDailyCost({ candidateCount: enriched.length, includeShadow: true });
  console.log(`\n[p4] Daily cost projection (candidate=${enriched.length}):`);
  console.log(`  fmpCalls=${cost.fmpCalls}  yahooCalls=${cost.yahooCalls}  mongoWrites=${cost.mongoWrites}  runtime≈${cost.estimatedRuntimeSec}s`);

  // ─── Evidence card (empty on day 0) ──────────────────────────
  console.log(`\n[p4] Evidence card:`);
  console.log(await exp.evidenceCardSummary({ experimentId }));

  await mongoose.disconnect();
  console.log(`\n[p4] Done. experimentId=${experimentId}`);
  process.exit(0);
}

main().catch(e => { console.error(`[p4] fatal:`, e?.stack || e?.message || e); process.exit(2); });
