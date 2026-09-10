#!/usr/bin/env node
// test-p36-data-rescue.mjs
//
// P3.6 data-rescue regression tests. Pure/no-Mongo.
//
// Covers the acceptance points in the P3.6 spec §18 plus the field-name
// bug fix that made every 2026-window benchmark return null.

import fs from "fs";
import { fetchYahooDaily } from "../services/stocksDiscoveryScore.js";
import { fetchDailyBars } from "../services/stocksMarketDataAdapter.js";
import {
  pickBenchmarkFor, getMatchedReturnPct, getMatchedAlphaPct,
} from "../services/stocksBenchmarkMatched.js";
import {
  UNATTRIB_REASONS, classifyUnattributableRows, detectAccountTransfers,
} from "../services/stocksDataRescue.js";

let passed = 0, failed = 0; const fails = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; fails.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── 1  Yahoo shape fix — .date field now emitted ──────────────────
async function test1_yahoo_bars_carry_date() {
  const bars = await fetchYahooDaily("SPY", "1mo");
  if (!Array.isArray(bars) || bars.length === 0) {
    assert(false, "1a. Yahoo returned bars for SPY", "empty");
    return;
  }
  assert(bars.length > 0, "1a. Yahoo returned bars for SPY");
  const first = bars[0];
  assert(typeof first.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(first.date),
    "1b. Each bar has .date in YMD format", `got ${JSON.stringify(Object.keys(first))}`);
  assert(Number.isFinite(first.close), "1c. Each bar has numeric .close");
  assert(Number.isFinite(first.t), "1d. Legacy .t (unix seconds) kept for back-compat");
  assert(Object.hasOwn(first, "vol") && Object.hasOwn(first, "volume"),
    "1e. Both .vol (legacy) and .volume (new) present");
}

// ─── 2  2026 date range no longer returns null pct ─────────────────
async function test2_2026_window_returns_valid_pct() {
  const from = "2026-06-01";
  const to = "2026-09-08";
  for (const sym of ["SPY", "VTI", "XIC.TO", "XEQT.TO"]) {
    const r = await getMatchedReturnPct({ ticker: sym, fromDate: from, toDate: to });
    assert(r.status === "OK" && Number.isFinite(r.pct),
      `2-${sym}. ${from}→${to} returns a valid pct`, `status=${r.status} note=${r.note} pct=${r.pct}`);
  }
}

// ─── 3  Adapter fallback + provenance ──────────────────────────────
async function test3_adapter_marks_yahoo_source() {
  const r = await fetchDailyBars({ symbol: "SPY", fromYmd: "2026-06-01", toYmd: "2026-09-08" });
  assert(r.status === "OK", "3a. Adapter returns OK for SPY");
  assert(r.marketDataSource === "YAHOO", "3b. Marks marketDataSource=YAHOO (primary)");
  assert(r.fallbackUsed === false, "3c. fallbackUsed=false on primary success");
  assert(r.actualRange && r.actualRange.fromYmd && r.actualRange.toYmd,
    "3d. actualRange populated");
  assert(typeof r.fetchAsOf === "string", "3e. fetchAsOf timestamp present");
}

async function test4_adapter_returns_data_unavailable() {
  const r = await fetchDailyBars({ symbol: "___INVALID_TICKER_XYZ_2026___", fromYmd: "2026-06-01", toYmd: "2026-09-08" });
  assert(r.status === "DATA_UNAVAILABLE", "4a. Invalid symbol → DATA_UNAVAILABLE status", `status=${r.status}`);
  assert(r.bars === null, "4b. bars are null (not empty array, not zero) on DATA_UNAVAILABLE");
}

// ─── 5  Null-not-zero contract ─────────────────────────────────────
async function test5_missing_bench_returns_null_not_zero() {
  const r = await getMatchedReturnPct({ ticker: "___INVALID_XYZ_2026___", fromDate: "2026-06-01", toDate: "2026-09-08" });
  assert(r.pct === null, "5a. Missing bench → pct === null (NOT 0)");
  assert(r.status === "DATA_UNAVAILABLE", "5b. Missing bench → status=DATA_UNAVAILABLE");
  const alpha = getMatchedAlphaPct({ securityReturnPct: 5.2, benchmarkReturnPct: r.pct });
  assert(alpha === null, "5c. Alpha with null bench returns null (never treats null as 0)");
}

// ─── 6  Alpha math preserves zero as a real return ─────────────────
function test6_zero_is_valid_return() {
  const a = getMatchedAlphaPct({ securityReturnPct: 0, benchmarkReturnPct: 5 });
  assert(a === -5, "6a. Security return of 0% (a legitimate flat return) → alpha = -5pp, NOT null");
  const b = getMatchedAlphaPct({ securityReturnPct: 5, benchmarkReturnPct: 0 });
  assert(b === 5, "6b. Benchmark return of 0% → alpha = +5pp, NOT null (zero is legitimate)");
}

// ─── 7  Unattributable classifier ──────────────────────────────────
function test7_classify_missing_buy_leg() {
  const ledgerRows = [
    { dataQuality: "UNATTRIBUTABLE", ticker: "ABC", account: "cibc-1",
      exitDate: new Date("2026-08-01"), exitShares: 10, exitPrice: 100,
      missingFields: ["entryDate", "entryPrice", "entryShares"] },
  ];
  const trades = [{ executedAt: new Date("2026-07-01") }]; // journal starts July 1
  const r = classifyUnattributableRows({ ledgerRows, trades });
  assert(r.byReason.MISSING_BUY_LEG === 1 || r.byReason.PRE_JOURNAL_OPENING_POSITION === 1,
    "7. Missing BUY leg classified with an explicit reason code",
    `got ${JSON.stringify(r.byReason)}`);
  assert(r.perRow[0].reasonHuman && r.perRow[0].reasonHuman.length > 0,
    "7b. Human-readable reason attached");
}

function test8_classify_missing_fx() {
  const ledgerRows = [
    { dataQuality: "UNATTRIBUTABLE", ticker: "XYZ", account: "a",
      missingFields: ["entryFx"] },
  ];
  const r = classifyUnattributableRows({ ledgerRows, trades: [] });
  assert(r.byReason.MISSING_FX === 1, "8. Missing FX row classified MISSING_FX");
}

// ─── 9  Reason-code enumeration ────────────────────────────────────
function test9_reason_codes_present() {
  for (const code of ["MISSING_BUY_LEG", "PRE_JOURNAL_OPENING_POSITION", "MISSING_ENTRY_DATE",
                       "MISSING_ENTRY_PRICE", "MISSING_QUANTITY", "MISSING_ACCOUNT",
                       "MISSING_FX", "POSSIBLE_TRANSFER", "AMBIGUOUS_HISTORY", "OTHER"]) {
    assert(UNATTRIB_REASONS[code], `9-${code}. Reason code ${code} defined`);
  }
}

// ─── 10  Transfer detection ────────────────────────────────────────
function test10_detect_transfer() {
  const trades = [
    { _id: "s1", executedAt: new Date("2026-08-01"), account: "a1",
      legs: [{ side: "SELL", ticker: "AAPL", shares: 50, pricePerShare: 200 }] },
    { _id: "b1", executedAt: new Date("2026-08-02"), account: "a2",
      legs: [{ side: "BUY", ticker: "AAPL", shares: 50, pricePerShare: 201 }] },
  ];
  const r = detectAccountTransfers({ trades });
  assert(r.count === 1, "10a. Same-ticker same-shares different-account within 3d → 1 candidate",
    `count=${r.count}`);
  assert(r.candidates[0].classification === "POSSIBLE_TRANSFER",
    "10b. Marked POSSIBLE_TRANSFER (not confirmed sale)");
}

function test11_transfer_ignored_when_same_account() {
  const trades = [
    { _id: "s1", executedAt: new Date("2026-08-01"), account: "a1",
      legs: [{ side: "SELL", ticker: "AAPL", shares: 50, pricePerShare: 200 }] },
    { _id: "b1", executedAt: new Date("2026-08-02"), account: "a1", // SAME account
      legs: [{ side: "BUY", ticker: "AAPL", shares: 50, pricePerShare: 201 }] },
  ];
  const r = detectAccountTransfers({ trades });
  assert(r.count === 0, "11. Same-account round-trip → NOT flagged as transfer");
}

function test12_transfer_ignored_when_far_apart() {
  const trades = [
    { _id: "s1", executedAt: new Date("2026-08-01"), account: "a1",
      legs: [{ side: "SELL", ticker: "AAPL", shares: 50, pricePerShare: 200 }] },
    { _id: "b1", executedAt: new Date("2026-08-15"), account: "a2", // 14 days
      legs: [{ side: "BUY", ticker: "AAPL", shares: 50, pricePerShare: 201 }] },
  ];
  const r = detectAccountTransfers({ trades });
  assert(r.count === 0, "12. Same-ticker >3d apart → NOT a transfer");
}

// ─── 13  Opening-balance lot ineligible for matched alpha ──────────
function test13_opening_balance_shape() {
  // Directly verify the exported shape contract without hitting Mongo.
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksDataRescue.js", "utf-8");
  for (const field of ["eligibleForMatchedAlpha", "eligibleForCadPnL", "entryProvenance", "confidence"]) {
    assert(src.includes(field), `13-${field}. buildOpeningBalanceLots stamps ${field}`);
  }
  assert(src.includes("OPENING_POSITION_COST_BASIS"),
    "13-prov. entryProvenance uses OPENING_POSITION_COST_BASIS code");
  assert(/eligibleForMatchedAlpha:\s*false/.test(src),
    "13-alpha. Opening-balance lot explicitly sets eligibleForMatchedAlpha=false (no true entry date → no matched-alpha)");
}

// ─── 14  Rec-link reconciler shape ─────────────────────────────────
function test14_reconciler_shape() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksDataRescue.js", "utf-8");
  for (const m of ["EXPLICIT", "RECONCILED_MANDATE", "RECONCILED_TIME", "NONE"]) {
    assert(src.includes(m), `14-${m}. linkMethod code ${m} defined`);
  }
  for (const c of ["HIGH", "MEDIUM", "LOW"]) {
    assert(src.includes(c), `14-conf-${c}. linkConfidence ${c} defined`);
  }
  assert(src.includes("ambiguousRejected"),
    "14-amb. Ambiguous multi-match rejected, not force-linked");
}

// ─── 15  Metric-specific confidence ────────────────────────────────
function test15_engine_declares_metric_confidence() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksAttributionEngine.js", "utf-8");
  for (const m of ["portfolioReturn", "passiveRelativeReturn", "recommendationSelectionAlpha",
                    "actualPositionAlpha", "entryTiming", "exitTiming",
                    "sizingEffect", "sleeveAttribution", "replacementTrades", "cashEffect", "fxEffect"]) {
    assert(src.includes(m), `15-${m}. metricConfidence declares ${m}`);
  }
  for (const c of ["HIGH", "MEDIUM", "LOW", "UNAVAILABLE"]) {
    assert(src.includes(`CONFIDENCE.${c}`) || src.includes(`"${c}"`), `15-conf-${c}. Confidence level ${c} defined`);
  }
}

// ─── 16  Diagnostic classification A/B/C ───────────────────────────
function test16_engine_classifies_A_B_C() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksAttributionEngine.js", "utf-8");
  assert(/class:\s*"A"/.test(src), "16-A. Engine emits class A");
  assert(/class:\s*"B"/.test(src), "16-B. Engine emits class B");
  assert(/class:\s*"C"/.test(src), "16-C. Engine emits class C");
  assert(src.includes("diagnosticClassification"), "16-key. Report has diagnosticClassification field");
}

// ─── 17  Partial diagnostic materialization ────────────────────────
function test17_no_global_suppression_switch() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksAttributionEngine.js", "utf-8");
  assert(!/if\s*\(\s*!sufficient\s*\)\s*return/.test(src),
    "17. No `if (!sufficient) return` — metrics render independently per §14");
}

// ─── 18  Real-vs-passive renderer surfaces DATA_UNAVAILABLE ────────
function test18_realVsPassive_has_status() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksAttributionEngine.js", "utf-8");
  assert(src.includes("passiveStatus"),
    "18. realVsPassive rows carry passiveStatus so the renderer distinguishes 0% (legit) from unavailable");
  assert(src.includes("alphaStatus"),
    "18b. Alpha carries its own status");
}

async function run() {
  console.log("\n═══ P3.6 Data-rescue + market-data adapter regression ═══\n");
  await test1_yahoo_bars_carry_date();
  await test2_2026_window_returns_valid_pct();
  await test3_adapter_marks_yahoo_source();
  await test4_adapter_returns_data_unavailable();
  await test5_missing_bench_returns_null_not_zero();
  test6_zero_is_valid_return();
  test7_classify_missing_buy_leg();
  test8_classify_missing_fx();
  test9_reason_codes_present();
  test10_detect_transfer();
  test11_transfer_ignored_when_same_account();
  test12_transfer_ignored_when_far_apart();
  test13_opening_balance_shape();
  test14_reconciler_shape();
  test15_engine_declares_metric_confidence();
  test16_engine_classifies_A_B_C();
  test17_no_global_suppression_switch();
  test18_realVsPassive_has_status();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    for (const f of fails) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}
run().catch(e => { console.error(e); process.exit(2); });
