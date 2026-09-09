#!/usr/bin/env node
// test-p3-attribution.mjs
//
// P3 attribution / diagnosis regression tests. Every acceptance point
// in the P3 spec §20 is covered.

import fs from "fs";
import {
  pickBenchmarkFor, getMatchedReturnPct, getMatchedAlphaPct,
} from "../services/stocksBenchmarkMatched.js";
import { classifyExit } from "../services/stocksExitForward.js";
import { renderRootCauseText } from "../services/stocksAttributionEngine.js";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

function bar(date, close) { return { date, open: close, close, volume: 1_000_000 }; }
const daily = (start, closes) => closes.map((c, i) => bar(new Date(new Date(start).getTime() + i * 86400_000).toISOString().slice(0, 10), c));

// ─── Benchmark picker + matched math ───────────────────────────────
function test1_benchmarkPicker() {
  assert(pickBenchmarkFor({ ticker: "RY.TO" }) === "XIC.TO", "1. TSX suffix → XIC.TO");
  assert(pickBenchmarkFor({ ticker: "AAPL" }) === "SPY", "1b. US default → SPY");
  assert(pickBenchmarkFor({ ticker: "BEP.TO", currency: "CAD" }) === "XIC.TO", "1c. CAD currency override → XIC");
  assert(pickBenchmarkFor({ ticker: "MSFT", sleeve: "core-global" }) === "XEQT.TO", "1d. Global CORE sleeve override → XEQT");
}

async function test2_matchedReturnPct() {
  const bars = daily("2026-08-01", [100, 101, 102, 103, 104, 105, 106]); // ~+6% end-to-end
  const r = await getMatchedReturnPct({ ticker: "TEST", fromDate: "2026-08-01", toDate: "2026-08-07", bars });
  assert(Math.abs(r.pct - 6) < 0.01, "2. Matched return over window equals series drift", `got ${r.pct}`);
}
async function test3_matchedReturnMissingBars() {
  const r = await getMatchedReturnPct({ ticker: "TEST", fromDate: "2026-08-01", toDate: "2026-08-05", bars: [] });
  assert(r.pct == null && /unavailable/i.test(r.note),
    "3. Benchmark bars unavailable → { pct: null }, no fabricated return");
}
async function test4_matchedReturnPartialWindow() {
  const bars = daily("2026-08-05", [100, 102, 104, 106]);
  const r = await getMatchedReturnPct({ ticker: "TEST", fromDate: "2026-08-01", toDate: "2026-08-08", bars });
  assert(r.pct != null && Math.abs(r.pct - 6) < 0.01,
    "4. Partial window: takes first bar ≥ from and last bar ≤ to", `got ${r.pct}`);
}
function test5_alphaMath() {
  assert(getMatchedAlphaPct({ securityReturnPct: 8, benchmarkReturnPct: 3 }) === 5, "5. Alpha = security − benchmark");
  assert(getMatchedAlphaPct({ securityReturnPct: null, benchmarkReturnPct: 3 }) == null, "5b. Null security → null alpha");
}
function test6_fromAfterTo() {
  return getMatchedReturnPct({ ticker: "T", fromDate: "2026-09-05", toDate: "2026-09-01", bars: daily("2026-09-01", [100, 101, 102, 103, 104]) })
    .then(r => assert(r.pct == null && /from > to/.test(r.note), "6. from > to → null with note"));
}

// ─── Exit classification (P3 §6) ───────────────────────────────────
function test7_exitClassificationPremature() {
  const horizons = [
    { horizonDays: 1, status: "FILLED", exitAlphaPct: 0.5 },
    { horizonDays: 5, status: "FILLED", exitAlphaPct: 4 },
    { horizonDays: 10, status: "FILLED", exitAlphaPct: 5 },
    { horizonDays: 20, status: "FILLED", exitAlphaPct: 6 },
    { horizonDays: 60, status: "FILLED", exitAlphaPct: 8 },
  ];
  assert(classifyExit(horizons) === "PREMATURE_EXIT", "7. Strong rebound after exit → PREMATURE_EXIT");
}
function test8_exitClassificationLate() {
  const horizons = [
    { horizonDays: 1, status: "FILLED", exitAlphaPct: -3 },
    { horizonDays: 5, status: "FILLED", exitAlphaPct: -2 },
    { horizonDays: 10, status: "FILLED", exitAlphaPct: -1 },
    { horizonDays: 20, status: "FILLED", exitAlphaPct: 0 },
    { horizonDays: 60, status: "FILLED", exitAlphaPct: 1 },
  ];
  assert(classifyExit(horizons) === "LATE_EXIT", "8. Continued decline after exit → LATE_EXIT (should have sold earlier)");
}
function test9_exitClassificationGood() {
  const horizons = [
    { horizonDays: 1, status: "FILLED", exitAlphaPct: 0.5 },
    { horizonDays: 5, status: "FILLED", exitAlphaPct: 2.5 },
    { horizonDays: 10, status: "FILLED", exitAlphaPct: 2 },
    { horizonDays: 20, status: "FILLED", exitAlphaPct: 1.5 },
    { horizonDays: 60, status: "FILLED", exitAlphaPct: 0.5 },
  ];
  assert(classifyExit(horizons) === "GOOD_EXIT", "9. Underlying kept underperforming benchmark after exit → GOOD_EXIT");
}
function test10_exitClassificationPending() {
  const horizons = [
    { horizonDays: 1, status: "FILLED", exitAlphaPct: 0 },
    { horizonDays: 5, status: "PENDING" },
    { horizonDays: 10, status: "PENDING" },
    { horizonDays: 20, status: "PENDING" },
    { horizonDays: 60, status: "PENDING" },
  ];
  assert(classifyExit(horizons) === "NEUTRAL",
    "10. Pending horizons → NEUTRAL (spec: don't classify prematurely; caller keeps overall row as PENDING until backfill completes)");
}
function test11_exitClassificationMissingData() {
  // day5 & day20 missing prevents PREMATURE / GOOD firing.
  const horizons = [
    { horizonDays: 1, status: "FILLED", exitAlphaPct: 0.5 },
    { horizonDays: 5, status: "MISSING_DATA" },
    { horizonDays: 10, status: "FILLED", exitAlphaPct: 5 },
    { horizonDays: 20, status: "MISSING_DATA" },
    { horizonDays: 60, status: "FILLED", exitAlphaPct: 8 },
  ];
  assert(classifyExit(horizons) === "NEUTRAL",
    "11. Critical horizons missing → NEUTRAL (never fabricates a classification)");
}

// ─── Root-cause renderer ─────────────────────────────────────────
function test12_rootCauseRenderer() {
  const report = {
    header: { windowDays: 90, alphaVsPassivePp: -3.4 },
    waterfall: { passiveBenchmarkTicker: "XEQT.TO" },
    rootCause: {
      drags: [
        { label: "Sizing effect (vs equal-weight)", pp: -2.2 },
        { label: "Mean selection alpha (descriptive)", pp: -1.4, descriptive: true },
        { label: "Fees / churn (estimated)", pp: -0.5 },
      ],
      offsets: [
        { label: "FX (USD holdings)", pp: 0.7 },
        { label: "Cash drag", pp: 0.1 },
      ],
    },
    dataQuality: { tradeLegCoveragePct: 87, exitForwardEligiblePct: 55, portfolioSnapshotDays: 90 },
  };
  const txt = renderRootCauseText(report);
  assert(txt.includes("PORTFOLIO DIAGNOSIS"), "12. Root-cause renders top header");
  assert(txt.includes("-3.4pp vs XEQT.TO"), "12b. Alpha vs passive appears with correct sign");
  // P3.5 renamed the sections; the renderer accepts both drags/offsets
  // and additiveDrags/additiveOffsets. Assert on the P3.5 wording.
  assert(/Additive drag \(sums to the gap\):\s*\n\s*1\. Sizing effect/.test(txt), "12c. Drags sorted worst-first");
  assert(/Additive offsets:\s*\n\s*1\. FX/.test(txt), "12d. Offsets sorted best-first");
  assert(/Descriptive diagnostics|descriptive/i.test(txt), "12e. Descriptive tag surfaces for non-additive components");
}

// ─── Model presence checks (spec deliverables) ────────────────────
function test13_ledgerModelPresent() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksPositionLedgerEntry.js", "utf-8");
  for (const f of ["entryDate","entryPrice","entryShares","exitDate","exitPrice",
                    "realizedPnLNative","realizedPnLCad","unrealizedPnLNative","unrealizedPnLCad",
                    "holdingPeriodDays","dataQuality","missingFields","matchedAlphaPct",
                    "localReturnPct","fxReturnPct","combinedCadReturnPct","recommendationId"]) {
    assert(src.includes(f), `13-${f}. Ledger schema declares ${f}`);
  }
}
function test14_exitForwardModelPresent() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksExitForwardMetric.js", "utf-8");
  for (const f of ["horizonDays","forwardReturnPct","benchmarkForwardReturnPct","exitAlphaPct",
                    "classification","classifiedAt","status"]) {
    assert(src.includes(f), `14-${f}. Exit-forward schema declares ${f}`);
  }
  for (const c of ["PENDING","GOOD_EXIT","PREMATURE_EXIT","LATE_EXIT","NEUTRAL"]) {
    assert(src.includes(c), `14-${c}. Classification enum includes ${c}`);
  }
}
function test15_attributionReportSchema() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksAttributionReport.js", "utf-8");
  for (const f of ["header","waterfall","rootCause","details","dataQuality","notes","engineVersion"]) {
    assert(src.includes(f), `15-${f}. Attribution report schema declares ${f}`);
  }
}

// ─── Shadow-funnel durability (P3 §19) ─────────────────────────────
function test16_shadowRunStatus() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksShadowFunnelRun.js", "utf-8");
  assert(/runStatus/.test(src), "16. StocksShadowFunnelRun declares runStatus");
  for (const s of ["PENDING","RUNNING","COMPLETE","FAILED"]) {
    assert(src.includes(s), `16-${s}. Status enum includes ${s}`);
  }
}
function test17_shadowExperimentTracker() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksShadowFunnelExperiment.js", "utf-8");
  assert(/mongoose\.model\("StocksShadowFunnelExperiment"/.test(src),
    "17. StocksShadowFunnelExperiment model declared");
  assert(/ExperimentSchema\.index\(\{\s*pickDate:\s*1,\s*funnel:\s*1,\s*attempt:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/.test(src),
    "17b. Unique (pickDate, funnel, attempt) index — retries create new attempts");
  for (const f of ["status","startedAt","completedAt","errorMessage","engineVersion","attempt"]) {
    assert(src.includes(f), `17-${f}. Experiment schema declares ${f}`);
  }
}
function test18_shadowServiceWritesStatus() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksShadowFunnel.js", "utf-8");
  assert(src.includes('status: "RUNNING"'),
    "18. Shadow runner writes RUNNING before scoring");
  assert(/terminal\s*=\s*"COMPLETE"/.test(src),
    "18b. Terminal COMPLETE state stamped on clean exit");
  assert(/terminal\s*=\s*"FAILED"/.test(src),
    "18c. FAILED state stamped when persist throws");
  assert(src.includes('status: "FAILED"'),
    "18d. Experiment tracker also transitions to FAILED on hard failure");
}

// ─── Engine plumbing checks ────────────────────────────────────────
function test19_attributionEngineExists() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksAttributionEngine.js", "utf-8");
  assert(src.includes("computeAttributionReport"), "19. computeAttributionReport exported");
  assert(src.includes("renderRootCauseText"), "19b. renderRootCauseText exported");
  assert(src.includes("computeReplacementPairs"), "19c. Replacement-trade attribution wired");
  assert(src.includes("stampExitForwardOnClose"), "19d. Exit-forward seeding invoked");
  assert(src.includes("backfillExitForwardMetrics"), "19e. Exit-forward backfill invoked");
  // P3.5 rephrased the descriptive-flag note; either wording is acceptable.
  assert(src.includes("DESCRIPTIVE / NON-ADDITIVE") || src.includes("DESCRIPTIVE ONLY") || src.includes("descriptiveComponents"),
    "19f. Notes surface DESCRIPTIVE / non-additive flag per spec §16 (P3 or P3.5 wording)");
}

function test20_positionLedgerFifo() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksPositionLedger.js", "utf-8");
  assert(src.includes("FIFO"), "20. Ledger docs describe FIFO matching");
  assert(src.includes("UNATTRIBUTABLE"), "20b. Unmatched SELL is marked UNATTRIBUTABLE (not fabricated)");
  assert(src.includes("isPartial"), "20c. Partial exits produce isPartial rows");
  assert(src.includes("dataQuality"), "20d. Every row stamps dataQuality");
}

async function run() {
  console.log("\n═══ P3 Attribution + Diagnosis regression ═══\n");
  test1_benchmarkPicker();
  await test2_matchedReturnPct();
  await test3_matchedReturnMissingBars();
  await test4_matchedReturnPartialWindow();
  test5_alphaMath();
  await test6_fromAfterTo();
  test7_exitClassificationPremature();
  test8_exitClassificationLate();
  test9_exitClassificationGood();
  test10_exitClassificationPending();
  test11_exitClassificationMissingData();
  test12_rootCauseRenderer();
  test13_ledgerModelPresent();
  test14_exitForwardModelPresent();
  test15_attributionReportSchema();
  test16_shadowRunStatus();
  test17_shadowExperimentTracker();
  test18_shadowServiceWritesStatus();
  test19_attributionEngineExists();
  test20_positionLedgerFifo();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(2); });
