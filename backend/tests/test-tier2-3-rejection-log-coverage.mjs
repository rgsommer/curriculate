// Tier 2.3 regression tests — persisted rejection log + missed-winner
// coverage KPI (audit Aug-28).
//
// These tests validate the CONTRACT (exports, schema shape, wiring)
// without hitting Mongo. Mongo-round-trip tests live in the CI
// integration suite; here we lock the API surface.

import fs from "fs";
import mongoose from "mongoose";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── StocksRejectionLog model ───────────────────────────────────
async function test1_rejectionLogModelExports() {
  const mod = await import("../models/StocksRejectionLog.js");
  assert(!!mod.default, "1. StocksRejectionLog default export exists", "");
  const M = mod.default;
  const paths = Object.keys(M.schema.paths);
  const required = ["email", "generatedAt", "ticker", "action", "origin", "reason", "detail", "snapshot", "sessionKey"];
  const missing = required.filter(p => !paths.includes(p));
  assert(missing.length === 0, "1b. All required fields present on schema",
    missing.length ? `missing: ${missing.join(", ")}` : "");
}

async function test2_rejectionLogOriginEnum() {
  const mod = await import("../models/StocksRejectionLog.js");
  const originEnum = mod.default.schema.paths.origin.enumValues;
  const expected = ["validator", "audit", "adversarial"];
  const matches = expected.every(e => originEnum.includes(e));
  assert(matches, "2. origin enum contains {validator, audit, adversarial}",
    `got ${JSON.stringify(originEnum)}`);
}

async function test3_rejectionLogIndexes() {
  const mod = await import("../models/StocksRejectionLog.js");
  const indexes = mod.default.schema.indexes();
  const flat = JSON.stringify(indexes);
  assert(/"email":1/.test(flat) && /"generatedAt":-1/.test(flat),
    "3. Composite index on (email, generatedAt desc) exists", "");
  assert(/"ticker":1/.test(flat) && /"generatedAt":-1/.test(flat),
    "3b. Composite index on (ticker, generatedAt desc) exists", "");
  assert(/"reason":1/.test(flat),
    "3c. Index on reason exists (for per-reason aggregation)", "");
}

// ─── Wired into validateRecs ────────────────────────────────────
function test4_validatorWiresPersistence() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksRecValidator.js",
    "utf-8"
  );
  assert(/persistRejectionsAsync\s*\(/.test(src),
    "4. validateRecs calls persistRejectionsAsync when ctx.email + ctx.generatedAt present", "");
  assert(/StocksRejectionLog/.test(src),
    "4b. Persistence uses StocksRejectionLog model", "");
  assert(/insertMany\(docs,\s*\{\s*ordered:\s*false\s*\}\)/.test(src),
    "4c. Uses ordered:false so one dud doesn't kill the batch", "");
}

// ─── StocksMissedWinnerCoverage model ───────────────────────────
async function test5_coverageModelExports() {
  const mod = await import("../models/StocksMissedWinnerCoverage.js");
  const M = mod.default;
  const paths = Object.keys(M.schema.paths);
  const required = ["observedAt", "asOfDate", "universeSize", "topDecileCount",
    "inOurUniverse", "inOurDiscovery", "inEither", "caughtEarly", "missed",
    "coveragePct", "caughtEarlyPct", "context", "samples", "error"];
  const missing = required.filter(p => !paths.includes(p));
  assert(missing.length === 0, "5. StocksMissedWinnerCoverage schema has all KPI fields",
    missing.length ? `missing: ${missing.join(", ")}` : "");
}

async function test6_coverageAsOfUniqueIndex() {
  const mod = await import("../models/StocksMissedWinnerCoverage.js");
  const indexes = mod.default.schema.indexes();
  const asOfIdx = indexes.find(([spec]) => spec.asOfDate === 1);
  assert(!!asOfIdx, "6. asOfDate index declared", "");
  assert(asOfIdx?.[1]?.unique === true, "6b. asOfDate index is unique (one snapshot per calendar day)",
    JSON.stringify(asOfIdx?.[1]));
}

async function test7_coverageSampleSchema() {
  const mod = await import("../models/StocksMissedWinnerCoverage.js");
  const sampleType = mod.default.schema.paths.samples;
  assert(sampleType.instance === "Array", "7. samples is an array", "");
  const sampleSchema = sampleType.schema || sampleType.caster?.schema;
  assert(!!sampleSchema, "7b. samples has a sub-schema", "");
  const sampleEnum = sampleSchema.paths.source?.enumValues;
  const expected = ["in-universe", "in-discovery", "caught-early", "missed"];
  assert(expected.every(e => sampleEnum?.includes(e)),
    "7c. sample.source enum contains all 4 attribution values",
    JSON.stringify(sampleEnum));
}

// ─── Coverage service ────────────────────────────────────────────
async function test8_coverageServiceExports() {
  const mod = await import("../services/stocksMissedWinnerCoverage.js");
  assert(typeof mod.computeMissedWinnerCoverage === "function",
    "8. computeMissedWinnerCoverage() exported", "");
  assert(typeof mod.getRecentCoverageKPIs === "function",
    "8b. getRecentCoverageKPIs() exported (for diagnostics endpoint)", "");
}

// ─── Cron ────────────────────────────────────────────────────────
async function test9_cronExists() {
  const mod = await import("../jobs/stocksCoverageKpiCron.js");
  assert(typeof mod.scheduleCoverageKpiCron === "function",
    "9. scheduleCoverageKpiCron exported", "");
  assert(typeof mod.runCoverageKpiSnapshot === "function",
    "9b. runCoverageKpiSnapshot exported (for manual/admin trigger)", "");
}

function test10_cronRegisteredInIndex() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/index.js",
    "utf-8"
  );
  assert(/scheduleCoverageKpiCron\s*\(\s*\)/.test(src),
    "10. scheduleCoverageKpiCron() called at startup in index.js", "");
  assert(/import.*scheduleCoverageKpiCron.*from\s+["'].*stocksCoverageKpiCron/.test(src),
    "10b. Cron imported in index.js", "");
}

// ─── Cron schedule sanity (05:30 America/Toronto default) ───────
function test11_cronDefaultSchedule() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksCoverageKpiCron.js",
    "utf-8"
  );
  assert(/["']30 5 \* \* \*["']/.test(src),
    "11. Cron defaults to 05:30 ET (between external-nominations 05:00 and briefings 07:30)", "");
  assert(/America\/Toronto/.test(src),
    "11b. Cron uses America/Toronto timezone (matches other stock crons)", "");
}

// ─── Cron kill switch ────────────────────────────────────────────
function test12_cronKillSwitch() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksCoverageKpiCron.js",
    "utf-8"
  );
  assert(/STOCKS_COVERAGE_KPI_ENABLED/.test(src),
    "12. Cron respects STOCKS_COVERAGE_KPI_ENABLED=0 kill switch", "");
}

// ─── Coverage service uses documented data sources ──────────────
function test13_coverageServiceReadsCorrectSources() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksMissedWinnerCoverage.js",
    "utf-8"
  );
  assert(/getBroadUniverse/.test(src),
    "13. Reads reference universe via getBroadUniverse", "");
  assert(/fetchYahooDaily/.test(src),
    "13b. Fetches daily bars via fetchYahooDaily", "");
  assert(/StocksDiscoveryCandidate/.test(src) && /StocksAdviceRec/.test(src),
    "13c. Joins to StocksDiscoveryCandidate + StocksAdviceRec for attribution", "");
}

// ─── Rejection persistence contract ──────────────────────────────
function test14_rejectionPersistenceContract() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksRecValidator.js",
    "utf-8"
  );
  // Snapshot fields — audit expects entryPrice, targetPrice, stopPrice,
  // sleeve, sourceLabel, structuralDriver at minimum for the corpus.
  const requiredSnapshotFields = ["entryPrice", "targetPrice", "stopPrice", "sleeve", "sourceLabel", "structuralDriver"];
  const missing = requiredSnapshotFields.filter(f => !src.includes(`${f}:`));
  assert(missing.length === 0, "14. Rejection snapshot preserves rec shape for counterfactual analysis",
    missing.length ? `missing: ${missing.join(", ")}` : "");
  // One doc per (rec, reason) — verify docs.push is inside the rejection loop
  assert(/for\s*\(\s*const\s+rej\s+of\s+r\.rejections/.test(src),
    "14b. One doc per (rec, reason) pair for per-reason aggregation", "");
}

async function run() {
  console.log("\n═══ Tier 2.3 — Rejection Log + Coverage KPI Regression Tests ═══\n");
  await test1_rejectionLogModelExports();
  await test2_rejectionLogOriginEnum();
  await test3_rejectionLogIndexes();
  test4_validatorWiresPersistence();
  await test5_coverageModelExports();
  await test6_coverageAsOfUniqueIndex();
  await test7_coverageSampleSchema();
  await test8_coverageServiceExports();
  await test9_cronExists();
  test10_cronRegisteredInIndex();
  test11_cronDefaultSchedule();
  test12_cronKillSwitch();
  test13_coverageServiceReadsCorrectSources();
  test14_rejectionPersistenceContract();

  // Close mongoose connection so the test process exits cleanly
  try { await mongoose.disconnect(); } catch { /* not connected */ }

  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const r of results.filter(x => x.status === "FAIL")) {
      console.log(`  • ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

run();
