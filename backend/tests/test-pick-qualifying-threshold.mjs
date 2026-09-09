#!/usr/bin/env node
// test-pick-qualifying-threshold.mjs
//
// P0B regression tests for the daily-pick absolute qualifying threshold
// + "NO QUALIFYING OPPORTUNITY TODAY" rendering + AI-invent-ticker
// gate + new distribution model shape.
//
// The failure mode this fixes: the pick engine returned n=2 picks
// unconditionally, even on days where no candidate cleared any sensible
// composite / external / confirmation threshold. Two mediocre ideas
// went into the briefing every day. Now:
//   • pick engine applies an absolute threshold (composite/nom/confirm)
//   • fewer than n qualifying → empty list, no manufactured picks
//   • full ranked distribution persisted for empirical calibration
//   • renderer emits "NO QUALIFYING OPPORTUNITY TODAY" instead of blank
//   • AI prompt explicitly forbids inventing tickers
//   • post-generation AI-invent gate rejects BUYs on tickers outside
//     the eligible universe

import fs from "fs";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

const ENGINE = "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js";
const BRIEF  = "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js";
const MODEL  = "/Users/richardsommer/dev/curriculate/backend/models/StocksPickDistribution.js";
const engineSrc = fs.readFileSync(ENGINE, "utf-8");
const briefSrc  = fs.readFileSync(BRIEF, "utf-8");
const modelSrc  = fs.readFileSync(MODEL, "utf-8");

// ─── 1. Pick engine imports & applies absolute threshold ──────────
function test1_engineConstantsDefined() {
  assert(/ABS_QUALIFYING_COMPOSITE\s*=\s*Number\(process\.env\.STOCKS_PICK_ABS_COMPOSITE\s*\|\|\s*75\)/.test(engineSrc),
    "1. ABS_QUALIFYING_COMPOSITE constant defined (default 75, env override)");
  assert(/ABS_QUALIFYING_EXTERNAL\s*=\s*Number\(process\.env\.STOCKS_PICK_ABS_EXTERNAL\s*\|\|\s*3\)/.test(engineSrc),
    "1b. ABS_QUALIFYING_EXTERNAL constant defined");
  assert(/ABS_QUALIFYING_CONFIRMATIONS\s*=\s*Number\(process\.env\.STOCKS_PICK_ABS_CONFIRMATIONS\s*\|\|\s*2\)/.test(engineSrc),
    "1c. ABS_QUALIFYING_CONFIRMATIONS constant defined");
}

function test2_engineFiltersByQualification() {
  assert(engineSrc.includes("qualifiedCombined = combined.filter(c => classifyDisqualification(c) == null)"),
    "2. Pick engine filters combined list through classifyDisqualification before slicing");
  assert(engineSrc.includes("top = qualifiedCombined.slice(0, n)"),
    "2b. Top picks come from the QUALIFIED subset (not the raw combined list)");
  assert(engineSrc.includes("NO QUALIFYING OPPORTUNITY TODAY"),
    "2c. Engine logs 'NO QUALIFYING OPPORTUNITY TODAY' branch");
}

function test3_engineLogsDistribution() {
  assert(engineSrc.includes("persistPickDistributionAsync"),
    "3. Engine calls persistPickDistributionAsync");
  assert(engineSrc.includes("StocksPickDistribution.findOneAndUpdate"),
    "3b. Persistence uses upsert (findOneAndUpdate) so retries are idempotent");
  assert(engineSrc.includes("noQualifyingOpportunity"),
    "3c. Distribution row carries the noQualifyingOpportunity flag");
}

function test4_nominationCountCaptured() {
  assert(engineSrc.includes("cand.nominationCount = Array.isArray(conviction?.nominations)"),
    "4. Nomination count captured on candidate for the ABS_EXTERNAL threshold");
}

function test5_countConfirmationFlagsExists() {
  assert(engineSrc.includes("function countConfirmationFlags"),
    "5. countConfirmationFlags helper exists");
  assert(engineSrc.includes("cand.mtfConfluence === \"aligned\""),
    "5b. MTF confluence counts as a confirmation");
  assert(engineSrc.includes("cand.qualityCompounderBadge"),
    "5c. Quality-compounder badge counts as a confirmation");
}

// ─── 6-9. Briefing rendering + prompt guards ───────────────────────
function test6_renderDeterministicNoQualifying() {
  assert(briefSrc.includes("NO QUALIFYING OPPORTUNITY"),
    "6. renderDailyPicksDeterministic emits NO QUALIFYING OPPORTUNITY on empty list");
  assert(briefSrc.includes("The scanner ran the full eligible universe today and no candidate cleared the absolute qualifying threshold"),
    "6b. Renderer explains WHY (threshold not cleared)");
}

function test7_promptBlockAiHardRules() {
  assert(briefSrc.includes("NO QUALIFYING OPPORTUNITY TODAY.**"),
    "7. AI prompt block includes the NO QUALIFYING OPPORTUNITY directive");
  assert(briefSrc.includes("Do NOT invent, backfill, resurrect"),
    "7b. AI prompt forbids inventing / backfilling / resurrecting tickers");
  assert(briefSrc.includes("Do NOT lower or bypass the threshold"),
    "7c. AI prompt forbids narrative threshold-lowering");
}

function test8_aiInventGatePresent() {
  assert(briefSrc.includes("[ai-invent-gate] rejected"),
    "8. Post-generation ai-invent-gate present with a warn log");
  assert(briefSrc.includes("allowedBuyBases"),
    "8b. Guard builds allowed-BUY-bases set");
  assert(briefSrc.includes("ai-invented-ticker"),
    "8c. Rejection reason is ai-invented-ticker");
}

function test9_allowedUniverseSources() {
  // The guard must union at least four sources: dailyPicks (unblocked),
  // prefixMandateRecs, discoveryPool, held positions.
  assert(/for \(const p of \(dailyPicks \|\| \[\]\)\)/.test(briefSrc),
    "9. Allowed universe includes dailyPicks");
  assert(/for \(const m of \(prefixMandateRecs \|\| \[\]\)\)/.test(briefSrc),
    "9b. Allowed universe includes prefixMandateRecs");
  assert(/for \(const d of \(discoveryPool \|\| \[\]\)\)/.test(briefSrc),
    "9c. Allowed universe includes discoveryPool");
  assert(/for \(const pos of \(profile\.positions \|\| \[\]\)\)/.test(briefSrc),
    "9d. Allowed universe includes held positions (ADD/BUY-more on existing)");
}

// ─── 10. StocksPickDistribution model shape ────────────────────────
function test10_modelSchema() {
  assert(modelSrc.includes("pickDate: { type: String, required: true"),
    "10. Distribution model has YYYY-MM-DD pickDate");
  assert(/PickDistributionSchema\.index\(\{\s*email:\s*1,\s*pickDate:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/.test(modelSrc),
    "10b. Unique (email, pickDate) index — idempotent upsert");
  assert(modelSrc.includes("qualified: { type: Boolean"),
    "10c. Candidate subdoc has qualified boolean");
  assert(modelSrc.includes("selected: { type: Boolean"),
    "10d. Candidate subdoc has selected boolean");
  assert(modelSrc.includes("disqualifyReason"),
    "10e. Candidate subdoc records disqualification reason for calibration");
  assert(modelSrc.includes("thresholds:"),
    "10f. Row captures the threshold values in force at generation time");
}

function run() {
  console.log("\n═══ P0B Qualifying-Threshold + Distribution Regression ═══\n");
  test1_engineConstantsDefined();
  test2_engineFiltersByQualification();
  test3_engineLogsDistribution();
  test4_nominationCountCaptured();
  test5_countConfirmationFlagsExists();
  test6_renderDeterministicNoQualifying();
  test7_promptBlockAiHardRules();
  test8_aiInventGatePresent();
  test9_allowedUniverseSources();
  test10_modelSchema();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run();
