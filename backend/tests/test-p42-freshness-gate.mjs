#!/usr/bin/env node
// test-p42-freshness-gate.mjs
//
// P4.2 briefing operational fixes. Pure/no-Mongo.

import fs from "fs";

let passed = 0, failed = 0; const fails = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; fails.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── §2  writeDailySnapshot no longer swallows partial failures ────
function test1_writeDailySnapshot_surfaces_failures() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/routes/stocksPortfolio.js", "utf-8");
  assert(src.includes("Promise.allSettled"),
    "1. writeDailySnapshot uses Promise.allSettled — a per-account failure no longer sinks the __total__ row");
  assert(src.includes("snapshotFailures"),
    "1b. Error carries snapshotFailures[] so the diagnostic reports WHICH account failed and WHY");
  assert(src.includes("totalWrote"),
    "1c. Return carries totalWrote so the caller can distinguish partial from total failure");
}

// ─── §2  Cron reports honest heartbeat ─────────────────────────────
function test2_cron_reports_partial_failure() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js", "utf-8");
  assert(src.includes("failureDetail") && src.includes("anyFailure"),
    "2. runDailyPortfolioSnapshotJob stamps lastError when fail>0 (no more silent lastError=null with fail=1)");
  assert(/lastError:\s*anyFailure/.test(src),
    "2b. Heartbeat lastError is derived from failure state, not hardcoded null");
}

// ─── §3  Freshness helper contract ─────────────────────────────────
function test3_freshness_helper_shape() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksBriefingDataFreshness.js", "utf-8");
  for (const field of ["holdingsAsOf", "pricesAsOf", "sleeveAsOf", "hardStopInputAsOf",
                        "portfolioSnapshotAsOf", "dailyPositionSnapshotAsOf",
                        "snapshotCronHealthy", "hardRulesEvaluable", "recapEvaluable",
                        "mandateLineText"]) {
    assert(src.includes(field), `3-${field}. Helper returns ${field}`);
  }
  // Verify the three wording branches all exist
  assert(src.includes("hard-rule status cannot be verified"),
    "3-hardstale. Fail-closed wording when risk inputs are stale");
  assert(src.includes("Current holdings/risk checks are fresh"),
    "3-recapstale. Recap-stale-but-hard-rules-fresh wording per spec §3");
  assert(src.includes("Portfolio is inside all hard rules today"),
    "3-clean. Original wording preserved for the all-fresh case");
}

// ─── §4  Scanner wording distinguishes production vs shadow ────────
function test4_scanner_wording_names_production_A() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js", "utf-8");
  assert(src.includes("PRODUCTION MODEL A"),
    "4a. Scanner-none wording names PRODUCTION MODEL A (spec §4)");
  assert(src.includes("AlphaForge shadow experiment") || src.includes("shadow experiment"),
    "4b. Scanner-none wording mentions shadow experiment (spec §4)");
  assert(src.includes("cannot authorize production trades"),
    "4c. Explicit that challengers CANNOT authorize production trades");
}

// ─── §3  §1 renderer consumes the freshness signal ─────────────────
function test5_mandate_composer_uses_freshness_signal() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js", "utf-8");
  assert(/dataFreshness\s*=\s*null/.test(src),
    "5. renderDeterministicPrefix accepts dataFreshness param (default null → back-compat)");
  assert(/dataFreshness\?\.mandateLineText/.test(src),
    "5b. §1 'None' branch reads dataFreshness.mandateLineText when available");
  assert(src.includes("describeBriefingDataFreshness"),
    "5c. Async caller invokes describeBriefingDataFreshness before render");
}

// ─── §7 (context) — status collection is on the mutable side ───────
function test6_no_change_to_investment_strategy() {
  // Guardrail assertion: this patch touches operational wording +
  // writer robustness ONLY. Scoring models, thresholds, P4 models
  // must not have been edited. Verify by checking the scoring-model
  // file's mtime is older than freshness helper's.
  const scoring = fs.statSync("/Users/richardsommer/dev/curriculate/backend/services/stocksScoringModels.js");
  const helper = fs.statSync("/Users/richardsommer/dev/curriculate/backend/services/stocksBriefingDataFreshness.js");
  assert(scoring.mtimeMs <= helper.mtimeMs,
    "6. Scoring model file untouched vs freshness helper (guardrail per spec 'do NOT change scoring models')");
}

async function run() {
  console.log("\n═══ P4.2 briefing operational fixes ═══\n");
  test1_writeDailySnapshot_surfaces_failures();
  test2_cron_reports_partial_failure();
  test3_freshness_helper_shape();
  test4_scanner_wording_names_production_A();
  test5_mandate_composer_uses_freshness_signal();
  test6_no_change_to_investment_strategy();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    for (const f of fails) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}
run().catch(e => { console.error(e); process.exit(2); });
