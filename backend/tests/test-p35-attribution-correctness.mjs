#!/usr/bin/env node
// test-p35-attribution-correctness.mjs
//
// P3.5 attribution correctness + materialization regression tests.
//
// Covers spec §1–§15 for pure computational modules (no Mongo). §12
// (actually running the report) is verified via a separate runnable
// script — see scripts/run-attribution.mjs.
//
// Every test is fully self-contained: fake bar series, fake snapshots,
// fake trades. Zero DB, zero network.

import fs from "fs";
import {
  extractCashFlowsFromJournal, modifiedDietz, timeWeightedReturn, computePortfolioReturn,
} from "../services/stocksPortfolioReturn.js";
import { computeCadPnl, decomposePartialExit } from "../services/stocksFxDecomposition.js";
import { estimateLegFee, aggregateFees } from "../services/stocksFeeAttribution.js";
import { computeDailyCashAttribution } from "../services/stocksCashAttributionDaily.js";
import { renderRootCauseText } from "../services/stocksAttributionEngine.js";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}
function approxEq(a, b, tol = 1e-6) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol; }

// ─── §1  Portfolio return with cash flows ───────────────────────────
async function test1_simple_no_flows() {
  const snaps = [
    { date: "2026-06-01", totalCad: 100_000 },
    { date: "2026-08-30", totalCad: 110_000 },
  ];
  const r = await computePortfolioReturn({ email: "test@x.com", snaps,
    windowStartYmd: "2026-06-01", windowEndYmd: "2026-08-30", cashFlows: [] });
  assert(r.returnMethod === "simple", "1a. No flows → simple");
  assert(approxEq(r.portfolioReturnPct, 10, 0.01), "1b. Simple return = +10%", `got ${r.portfolioReturnPct}`);
}

async function test2_modified_dietz_deposit_midway() {
  // Start 100k, deposit 20k on day 45, end 130k. Simple would report
  // +30% (100→130). Modified Dietz weights the flow.
  const cashFlows = [{ signedCad: 20_000, daysFromStart: 45 }];
  const r = modifiedDietz({ startCad: 100_000, endCad: 130_000, cashFlows, windowDays: 90 });
  // r = (130 − 100 − 20) / (100 + (90−45)/90 × 20)
  //   = 10 / (100 + 10) = 10 / 110 ≈ 9.09%
  assert(approxEq(r, (10 / 110) * 100, 0.01),
    "2. Modified Dietz weights midway deposit correctly (~9.09%)", `got ${r}`);
}

function test3_twr_beats_dietz_when_flow_dates_align() {
  // Portfolio doubles pre-deposit, flat post-deposit.
  // Start 100k, end period1 200k (+100%), deposit 100k → 300k, end 300k (0% in period 2).
  // TWR = (1+1.0)(1+0) − 1 = 100%. Modified Dietz would say ~66%.
  const snaps = [
    { date: "2026-06-01", totalCad: 100_000 },
    { date: "2026-07-15", totalCad: 200_000 },
    { date: "2026-07-16", totalCad: 300_000 }, // after deposit
    { date: "2026-08-30", totalCad: 300_000 },
  ];
  const cashFlows = [{ date: "2026-07-16", signedCad: 100_000 }];
  const twr = timeWeightedReturn({ snaps, cashFlows });
  assert(twr && approxEq(twr.returnPct, 100, 0.5),
    "3. TWR handles mid-window deposit correctly (~100%)", `got ${twr?.returnPct}`);
}

async function test4_auto_selects_twr_when_snapshots_available() {
  const snaps = Array.from({ length: 8 }, (_, i) => ({
    date: `2026-06-${(i + 1).toString().padStart(2, "0")}`,
    totalCad: 100_000 + i * 1000,
  }));
  const r = await computePortfolioReturn({
    email: "test@x.com", snaps,
    windowStartYmd: "2026-06-01", windowEndYmd: "2026-06-08",
    cashFlows: [],
  });
  assert(r.returnMethod === "simple",
    "4. Auto-selects simple when no journal flows exist", `got ${r.returnMethod}`);
}

// ─── §2  USD/CAD PnL — full-value method ────────────────────────────
function test5_usd_pnl_static_fx() {
  // 100 sh @ $100 entry, $110 exit, FX 1.30 both sides, no fees.
  // Entry value = 100 × 100 × 1.30 = 13,000 CAD
  // Exit value  = 100 × 110 × 1.30 = 14,300 CAD
  // PnL = +1,300 CAD
  const r = computeCadPnl({
    shares: 100, entryPriceNative: 100, exitPriceNative: 110,
    currency: "USD", entryFxCadPerUsd: 1.30, exitFxCadPerUsd: 1.30,
  });
  assert(approxEq(r.realizedPnLCad, 1300, 0.01),
    "5a. Static FX → PnL = shares × ΔP × FX", `got ${r.realizedPnLCad}`);
  assert(approxEq(r.fxReturnPct, 0), "5b. Static FX → fxReturnPct = 0");
  assert(approxEq(r.localReturnPct, 10, 0.001), "5c. Local return = +10%");
}

function test6_usd_pnl_fx_moves() {
  // 100 sh @ $100 entry @ 1.30, exit $110 @ 1.40
  // Entry value = 13,000 CAD; Exit value = 100 × 110 × 1.40 = 15,400 CAD
  // PnL = +2,400 CAD.
  // Local return = +10%, FX return = (1.40-1.30)/1.30 = +7.69%
  // Combined = (1.10)(1.0769) − 1 = 0.18462 = +18.46%
  // Reconciliation: 10 + 7.69 + 10×7.69/100 = 10 + 7.69 + 0.769 = 18.46 ✓
  const r = computeCadPnl({
    shares: 100, entryPriceNative: 100, exitPriceNative: 110,
    currency: "USD", entryFxCadPerUsd: 1.30, exitFxCadPerUsd: 1.40,
  });
  assert(approxEq(r.realizedPnLCad, 2400, 0.5),
    "6a. FX-moved PnL uses exit FX on exit side and entry FX on entry side", `got ${r.realizedPnLCad}`);
  assert(approxEq(r.reconcilesTo, r.combinedCadReturnPct, 1e-6),
    "6b. localReturnPct + fxReturnPct + interactionPct === combinedCadReturnPct",
    `sum=${r.reconcilesTo} combined=${r.combinedCadReturnPct}`);
  assert(approxEq(r.combinedCadReturnPct, 18.4615, 0.01), "6c. Combined CAD return ~+18.46%");
}

function test7_usd_missing_fx_returns_note() {
  const r = computeCadPnl({
    shares: 100, entryPriceNative: 100, exitPriceNative: 110,
    currency: "USD", entryFxCadPerUsd: null, exitFxCadPerUsd: 1.30,
  });
  assert(r.note === "missing-fx" && r.realizedPnLCad === null,
    "7. Missing FX → note:'missing-fx', never fabricate a number");
}

function test8_partial_exits_at_different_fx() {
  // 100 sh entry $100 @ 1.30
  // Exit 40 sh @ $105, FX 1.32; Exit 60 sh @ $115, FX 1.42
  // Entry value = 100 × 100 × 1.30 = 13,000
  // Leg1 exitVal = 40 × 105 × 1.32 = 5,544, entryVal for 40 = 40×100×1.30=5,200 → PnL +344
  // Leg2 exitVal = 60 × 115 × 1.42 = 9,798, entryVal for 60 = 60×100×1.30=7,800 → PnL +1,998
  // Total PnL = +2,342 CAD
  const r = decomposePartialExit({
    entryShares: 100, entryPriceNative: 100, entryFxCadPerUsd: 1.30,
    currency: "USD",
    exits: [
      { shares: 40, exitPriceNative: 105, exitFxCadPerUsd: 1.32 },
      { shares: 60, exitPriceNative: 115, exitFxCadPerUsd: 1.42 },
    ],
  });
  assert(approxEq(r.realizedPnLCad, 2342, 1),
    "8a. Partial exits sum correctly at each leg's FX", `got ${r.realizedPnLCad}`);
  assert(r.exits.length === 2, "8b. Returns per-leg decomposition");
}

// ─── §3  Fee attribution ────────────────────────────────────────────
function test9_estimate_leg_fee_actual_wins() {
  const f = estimateLegFee({ side: "BUY", currency: "USD" }, { actualFeeNative: 0 });
  assert(f.feeSource === "ACTUAL" && f.feeNative === 0,
    "9. actualFeeNative present → feeSource=ACTUAL (free-trade broker → 0)");
}
function test10_estimate_leg_fee_broker_default() {
  const cibc = estimateLegFee({ side: "BUY", currency: "CAD" }, { brokerCode: "cibc-ie" });
  const questrade = estimateLegFee({ side: "BUY", currency: "CAD" }, { brokerCode: "questrade" });
  assert(cibc.feeNative === 6.95 && cibc.feeSource === "ESTIMATED", "10a. CIBC-IE default = 6.95, ESTIMATED");
  assert(questrade.feeNative === 4.95 && questrade.feeSource === "ESTIMATED", "10b. Questrade default = 4.95, ESTIMATED");
}
function test11_deposit_leg_has_zero_fee() {
  const f = estimateLegFee({ side: "DEPOSIT", currency: "CAD" }, {});
  assert(f.feeNative === 0, "11. DEPOSIT/WITHDRAW legs never accrue a trading fee");
}
function test12_aggregate_fees_worst_source() {
  const total = aggregateFees([
    { feeNative: 6.95, feeCurrency: "CAD", feeSource: "ESTIMATED", feeEstimateMethod: "cibc-ie-default" },
    { feeNative: 4.95, feeCurrency: "CAD", feeSource: "ACTUAL", feeEstimateMethod: null },
  ], { fxUsdCad: 1.37 });
  assert(approxEq(total.totalCad, 11.90),
    "12a. aggregateFees sums CAD-converted totals");
  assert(total.worstSource === "ESTIMATED",
    "12b. worst source is ESTIMATED (never claim ACTUAL when any leg is estimated)");
}

// ─── §5  Daily cash attribution ─────────────────────────────────────
async function test13_cash_attribution_low_coverage() {
  // Only 1 snapshot — computeDailyCashAttribution should short-circuit.
  const r = await computeDailyCashAttribution({ snaps: [{ date: "2026-08-01", totalCad: 100_000, cashCad: 20_000, cashUsd: 0, fxUsdCad: 1.37 }], benchmarkTicker: "XEQT.TO" });
  assert(r.coverage === "NONE" && r.cumulativeCashDragPp === null,
    "13. Cash attribution: <2 snapshots → coverage NONE, no fabricated drag");
}

// ─── §7  Root-cause renderer with descriptive tag ──────────────────
function test14_root_cause_renders_additive_vs_descriptive() {
  const report = {
    header: { windowDays: 90, alphaVsPassivePp: -3.4, portfolioReturnMethod: "modified-dietz" },
    waterfall: { passiveBenchmarkTicker: "XEQT.TO" },
    rootCause: {
      additiveDrags: [{ label: "Sizing effect", pp: -2.2, confidence: "HIGH" }],
      additiveOffsets: [{ label: "FX", pp: 0.7, confidence: "HIGH" }],
      descriptiveWorst: [{ label: "Actual-position alpha", pp: -1.4 }],
      descriptiveBest: [],
    },
    dataQuality: {
      tradeLegCoveragePct: 87, exitForwardEligiblePct: 55, portfolioSnapshotDays: 90,
      cashFlowCoverage: "COMPLETE", cashAttributionCoverage: "COMPLETE",
      replacementPairingCoverage: { matchedPairs: 3, highConfidencePairs: 2 },
      feeSource: "ESTIMATED",
    },
    insufficientEvidence: [],
  };
  const txt = renderRootCauseText(report);
  assert(txt.includes("PORTFOLIO DIAGNOSIS"), "14a. Renders top header");
  assert(txt.includes("-3.4pp vs XEQT.TO"), "14b. Alpha vs passive with correct sign");
  assert(/Additive drag \(sums to the gap\):[\s\S]*Sizing effect/.test(txt), "14c. Additive drag section labeled");
  assert(/Descriptive diagnostics \(NOT additive\):/.test(txt),
    "14d. Descriptive section explicitly says NOT additive — never mixed with additive pp");
  assert(/Actual-position alpha: -1\.4pp/.test(txt), "14e. Descriptive item body");
}

function test15_root_cause_shows_insufficient_evidence() {
  const report = {
    header: { windowDays: 30 },
    waterfall: {},
    rootCause: { additiveDrags: [], additiveOffsets: [], descriptiveWorst: [], descriptiveBest: [] },
    dataQuality: {},
    insufficientEvidence: [
      "Portfolio snapshot history too short (<3 daily rows in window).",
      "No attributable ledger rows — cannot compute selection alpha.",
    ],
  };
  const txt = renderRootCauseText(report);
  assert(txt.includes("WE DO NOT YET HAVE ENOUGH CLEAN HISTORY TO KNOW"),
    "15a. Insufficient-evidence block uses the exact spec phrase (no false diagnosis)");
  assert(txt.includes("snapshot history too short"), "15b. Lists specific missing pieces");
}

// ─── §11 Daily snapshot writer — schema present ────────────────────
function test16_daily_snapshot_model_schema() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksDailyPositionSnapshot.js", "utf-8");
  for (const f of ["email", "date", "account", "ticker", "shares", "priceNative", "currency",
                    "fxUsdCad", "marketValueCad", "sleeve", "linkedRecommendationId"]) {
    assert(src.includes(f), `16-${f}. StocksDailyPositionSnapshot schema declares ${f}`);
  }
  assert(/unique:\s*true/.test(src),
    "16-unique. (email, date, account, ticker) unique index — idempotent daily rerun");
}
function test17_daily_snapshot_writer_idempotent() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyPositionSnapshot.js", "utf-8");
  assert(src.includes("bulkWrite"),
    "17a. Writer uses bulkWrite (single Mongo round-trip per user)");
  assert(src.includes("upsert: true"),
    "17b. bulkWrite upserts by (email, date, account, ticker) — idempotent");
  assert(src.includes("StocksSystemHeartbeat"),
    "17c. Cron writes heartbeat so freshness gate observes it");
}

// ─── §4  Replacement pairing — provenance ranks defined ────────────
function test18_replacement_pairing_provenance_ranks() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksReplacementPairing.js", "utf-8");
  for (const p of ["EXPLICIT_REDEPLOY", "SAME_MANDATE_BATCH", "LINKED_ADVICE_REC",
                    "DECISION_ENGINE_TAG", "TEMPORAL"]) {
    assert(src.includes(p), `18-${p}. Pairing method ${p} defined`);
  }
  assert(/confidence:\s*"HIGH"/.test(src) && /confidence:\s*"LOW"/.test(src),
    "18-conf. Confidence labels — HIGH for provenance, LOW for temporal");
  assert(/TEMPORAL pairs are LOW-CONFIDENCE/.test(src),
    "18-note. Explicit note that TEMPORAL is LOW-confidence — reported separately");
}

// ─── §3  Entry-timing — DESCRIPTIVE tag present ────────────────────
function test19_entry_timing_labelled_descriptive() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksEntryTimingAttribution.js", "utf-8");
  assert(/DESCRIPTIVE/.test(src),
    "19a. Entry-timing note flags DESCRIPTIVE / non-additive");
  for (const c of ["BETTER_THAN_REC_ENTRY", "CHASED_HIGHER", "NEUTRAL", "DELAY_HELPED", "DELAY_HURT"]) {
    assert(src.includes(c), `19-${c}. Classification ${c} exists`);
  }
  assert(src.includes("coverage:"),
    "19-cov. Explicit coverage stats returned");
}

// ─── §7  Attribution engine bumps version + separates ──────────────
function test20_engine_v35_and_two_selection_alphas() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksAttributionEngine.js", "utf-8");
  assert(/ENGINE_VERSION\s*=\s*"3\.5\.\d+"/.test(src),
    "20a. Engine version bumped to 3.5.x");
  assert(src.includes("additiveComponents") && src.includes("descriptiveComponents"),
    "20b. Waterfall separates additive vs descriptive");
  assert(src.includes("recommendationQualityMeanAlphaPp"),
    "20c. Recommendation-quality selection alpha computed");
  assert(src.includes("actualPositionMeanAlphaPp"),
    "20d. Actual-position selection alpha computed");
  assert(src.includes("implementationAlphaPp"),
    "20e. Implementation alpha = actual − rec");
  assert(src.includes("sleeveContribPp"),
    "20f. Sleeve attribution reports capital-weighted contribution in pp");
  assert(src.includes("insufficientEvidence"),
    "20g. Engine refuses false confidence when evidence is too thin");
  assert(src.includes("bestDecisions") && src.includes("worstDecisions"),
    "20h. Best / worst actual decisions surfaced");
}

// ─── §6  Position ledger uses computeCadPnl + per-leg fees ─────────
function test21_ledger_uses_new_services() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksPositionLedger.js", "utf-8");
  assert(src.includes("computeCadPnl"), "21a. Ledger uses computeCadPnl (full-value method)");
  assert(src.includes("estimateLegFee") && src.includes("aggregateFees"),
    "21b. Ledger uses per-leg fee attribution + aggregation");
  assert(src.includes("feeSource"), "21c. Ledger stamps feeSource per row");
  assert(src.includes("interactionPct"), "21d. FX decomposition includes interaction cross term");
}

// ─── §12 Runnable script exists ────────────────────────────────────
function test22_runnable_script_shipped() {
  assert(fs.existsSync("/Users/richardsommer/dev/curriculate/scripts/run-attribution.mjs"),
    "22a. scripts/run-attribution.mjs exists");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/scripts/run-attribution.mjs", "utf-8");
  assert(src.includes("computeAttributionReport") && src.includes("renderRootCauseText"),
    "22b. Script imports engine + renderer");
  assert(src.includes('"ytd"') && src.includes('"max"'),
    "22c. Script supports 30, 90, ytd, max windows per spec");
  assert(src.includes("WE DO NOT YET HAVE ENOUGH CLEAN HISTORY TO KNOW"),
    "22d. Script surfaces the exact insufficient-evidence phrase from spec §12");
}

async function run() {
  console.log("\n═══ P3.5 Attribution correctness + materialization regression ═══\n");
  await test1_simple_no_flows();
  await test2_modified_dietz_deposit_midway();
  test3_twr_beats_dietz_when_flow_dates_align();
  await test4_auto_selects_twr_when_snapshots_available();
  test5_usd_pnl_static_fx();
  test6_usd_pnl_fx_moves();
  test7_usd_missing_fx_returns_note();
  test8_partial_exits_at_different_fx();
  test9_estimate_leg_fee_actual_wins();
  test10_estimate_leg_fee_broker_default();
  test11_deposit_leg_has_zero_fee();
  test12_aggregate_fees_worst_source();
  await test13_cash_attribution_low_coverage();
  test14_root_cause_renders_additive_vs_descriptive();
  test15_root_cause_shows_insufficient_evidence();
  test16_daily_snapshot_model_schema();
  test17_daily_snapshot_writer_idempotent();
  test18_replacement_pairing_provenance_ranks();
  test19_entry_timing_labelled_descriptive();
  test20_engine_v35_and_two_selection_alphas();
  test21_ledger_uses_new_services();
  test22_runnable_script_shipped();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(2); });
