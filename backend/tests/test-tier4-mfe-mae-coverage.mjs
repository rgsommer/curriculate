// Tier 4 regression tests — per-rec MFE/MAE tracking + coverage KPI
// dashboard endpoint contract.

import mongoose from "mongoose";
import fs from "fs";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── StocksAdviceRec schema — new Tier 4 fields ─────────────────
async function test1_mfeMaeFieldsPresent() {
  const mod = await import("../models/StocksAdviceRec.js");
  const paths = Object.keys(mod.default.schema.paths);
  const required = [
    "peakPrice", "peakPct", "peakAt",
    "troughPrice", "troughPct", "troughAt",
    "postExitPeakPct", "postExitPeakAt", "postExitTrackingUntil",
  ];
  const missing = required.filter(p => !paths.includes(p));
  assert(missing.length === 0,
    "1. All Tier 4 MFE/MAE + post-exit-tracking fields on StocksAdviceRec schema",
    missing.length ? `missing: ${missing.join(", ")}` : "");
}

async function test2_fieldsHaveCorrectTypes() {
  const mod = await import("../models/StocksAdviceRec.js");
  const paths = mod.default.schema.paths;
  assert(paths.peakPrice.instance === "Number", "2. peakPrice is Number", "");
  assert(paths.peakPct.instance === "Number", "2b. peakPct is Number (signed pct)", "");
  assert(paths.peakAt.instance === "Date", "2c. peakAt is Date", "");
  assert(paths.postExitPeakPct.instance === "Number", "2d. postExitPeakPct is Number", "");
  assert(paths.postExitTrackingUntil.instance === "Date", "2e. postExitTrackingUntil is Date", "");
}

// ─── Nightly outcome sweep — Tier 4 logic ───────────────────────
function test3_sweepUpdatesMfeMae() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksRecOutcomeNightly.js",
    "utf-8"
  );
  assert(/rec\.peakPrice/.test(src),
    "3. Nightly sweep reads existing peakPrice for comparison", "");
  assert(/setFields\.peakPrice\s*=\s*px/.test(src),
    "3b. Sweep updates peakPrice when a new best mark is observed", "");
  assert(/setFields\.troughPrice\s*=\s*px/.test(src),
    "3c. Sweep updates troughPrice when a new worst mark is observed", "");
  assert(/mfeMaeUpdated/.test(src),
    "3d. Sweep counts MFE/MAE updates for the summary log", "");
}

function test4_sweepPullsPostExitRecs() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksRecOutcomeNightly.js",
    "utf-8"
  );
  assert(/postExitRecs\s*=\s*await StocksAdviceRec\.find/.test(src),
    "4. Sweep pulls closed recs within 90d post-exit window", "");
  assert(/postExitTrackingUntil/.test(src),
    "4b. Sweep filters on postExitTrackingUntil field", "");
  assert(/postExitPeakPct/.test(src),
    "4c. Sweep updates postExitPeakPct on closed-but-tracked recs", "");
}

function test5_sweepStartsPostExitTrackingOnFlip() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksRecOutcomeNightly.js",
    "utf-8"
  );
  // When status transitions from open, the sweep must stamp
  // postExitTrackingUntil = now + 90d
  assert(/setFields\.postExitTrackingUntil\s*=\s*new Date\(now\s*\+\s*90\s*\*\s*86400000\)/.test(src),
    "5. On status flip, sweep starts 90-day post-exit tracking window", "");
  assert(/setFields\.postExitPeakPct\s*=\s*0/.test(src),
    "5b. postExitPeakPct initialized to 0 at status-flip time", "");
}

// ─── Coverage KPI endpoint contract ─────────────────────────────
function test6_coverageEndpointExists() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/routes/stocksAdvice.js",
    "utf-8"
  );
  assert(/router\.get\(["']\/coverage-kpi["']/.test(src),
    "6. GET /coverage-kpi route registered", "");
  assert(/getRecentCoverageKPIs/.test(src),
    "6b. Endpoint uses getRecentCoverageKPIs service", "");
  assert(/avgCoveragePct/.test(src),
    "6c. Endpoint returns rolling-average coverage summary", "");
}

function test7_mfeMaeEndpointExists() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/routes/stocksAdvice.js",
    "utf-8"
  );
  assert(/router\.get\(["']\/rec-mfe-mae["']/.test(src),
    "7. GET /rec-mfe-mae route registered", "");
  assert(/peakPct/.test(src) && /troughPct/.test(src),
    "7b. Endpoint returns MFE (peakPct) + MAE (troughPct) fields", "");
  assert(/postExitPeakPct/.test(src),
    "7c. Endpoint returns postExitPeakPct for sold-too-early analysis", "");
  assert(/soldTooEarlyPct/.test(src),
    "7d. Endpoint computes sold-too-early rate", "");
}

// ─── MFE/MAE direction correctness ──────────────────────────────
// The audit is specific: BUY vs SELL should both express favourable
// vs adverse from the operator's perspective. peakPct is MFE (max
// favourable), troughPct is MAE (max adverse), both signed by
// direction — not raw price delta.
function test8_signedByDirection() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksRecOutcomeNightly.js",
    "utf-8"
  );
  // Verify: MFE/MAE update code branches on isLong (BUY/HOLD vs SELL/TRIM)
  // for the "best" and "worst" checks.
  assert(/const\s+isLong\s*=\s*rec\.action\s*===\s*["']BUY["']\s*\|\|\s*rec\.action\s*===\s*["']HOLD["']/.test(src),
    "8. Sweep computes isLong from rec.action for direction-aware peak/trough", "");
  // The peak-check is "px > currentBest for BUY, px < currentBest for SELL"
  assert(/isLong\s*\?\s*px\s*>\s*currentBest\s*:\s*px\s*<\s*currentBest/.test(src),
    "8b. peak comparison is direction-aware (BUY max, SELL min)", "");
}

async function run() {
  console.log("\n═══ Tier 4 — Per-Rec MFE/MAE + Coverage KPI Dashboard Tests ═══\n");
  await test1_mfeMaeFieldsPresent();
  await test2_fieldsHaveCorrectTypes();
  test3_sweepUpdatesMfeMae();
  test4_sweepPullsPostExitRecs();
  test5_sweepStartsPostExitTrackingOnFlip();
  test6_coverageEndpointExists();
  test7_mfeMaeEndpointExists();
  test8_signedByDirection();

  try { await mongoose.disconnect(); } catch { /* ignore */ }

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
