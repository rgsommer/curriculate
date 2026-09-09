#!/usr/bin/env node
// test-decision-engine.mjs
//
// P1 regression tests: DETERMINISTIC DECISION ENGINE + decision card
// renderer + AI-contradiction guard integration.
//
// Architecture principle these tests enforce:
//   Deterministic action first, AI explanation second.
//   AI cannot change HOLD → SELL etc. via prose or <RECS>.
//
// Sleeve-specific classifier rules covered:
//   CORE   — default HOLD; SELL/TRIM only on concentration breach or
//            mandate mismatch. Tactical ATR/drawdown alone must NOT
//            produce SELL/TRIM.
//   INCOME — payout ratio > 90% ⇒ SELL; > 65% ⇒ TRIM. Negative FCF
//            yield ⇒ SELL. Missing fundamentals ⇒ DEFERRED (never
//            silent HOLD).
//   SWING  — hard-stop-hit ⇒ SELL; trail-stop breach ≥12% drawdown ⇒
//            SELL; horizon expired ⇒ SELL; sector hostile ⇒ TRIM.
//   SPEC   — same as SWING but stricter: latent warning without a
//            qualifying override becomes SELL, not HOLD.
//   BUY    — new opportunities from dailyPicks pass through as BUY
//            decisions with confidence keyed to composite.

import { buildDecisions, ACTION, CONFIDENCE, FRESHNESS } from "../services/stocksDecisionEngine.js";
import { renderDecisionCard } from "../services/stocksDecisionRenderer.js";
import fs from "fs";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── CORE ────────────────────────────────────────────────────────────
function test1_coreDefaultHold() {
  const ds = buildDecisions({
    positions: [{ ticker: "XEQT.TO", qty: 100, ccy: "CAD", account: "RRSP" }],
    concentrationByTicker: { "XEQT": 12 },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "1. CORE default is HOLD",
    `got action=${d?.action}`);
  assert(d?.confidence === CONFIDENCE.HIGH,
    "1b. CORE HOLD carries HIGH confidence");
  assert(d?.nextReview?.type === "structural-trigger",
    "1c. CORE HOLD review is event-driven (structural trigger), not calendar");
}

function test2_coreConcentrationTriggersTrim() {
  const ds = buildDecisions({
    positions: [{ ticker: "XEQT.TO", qty: 300, ccy: "CAD", account: "RRSP" }],
    concentrationByTicker: { "XEQT": 27 },
  });
  const d = ds[0];
  assert(d?.action === ACTION.TRIM,
    "2. CORE with 27% concentration → TRIM",
    `got action=${d?.action}`);
  assert(d?.shares > 0 && d?.shares < 300,
    "2b. Trim shares are between 1 and full position");
  assert(/concentration-breach/.test(d?.reason || ""),
    "2c. Rule name identifies concentration breach");
}

function test3_coreTacticalDrawdownDoesNotSell() {
  // A CORE ETF with a 6% drawdown should stay HOLD — CORE rule
  // explicitly forbids tactical drawdown from driving SELL/TRIM.
  const ds = buildDecisions({
    positions: [{ ticker: "XEQT.TO", qty: 100, ccy: "CAD", account: "RRSP" }],
    concentrationByTicker: { "XEQT": 8 },
    trailStopByTicker: { "XEQT.TO": { drawdownPct: 6 } },
    monitor: { withinStop: [], hardStopHit: [] },
  });
  assert(ds[0]?.action === ACTION.HOLD,
    "3. CORE with tactical 6% drawdown stays HOLD (not TRIM)");
}

// ─── INCOME ──────────────────────────────────────────────────────────
function test4_incomeMissingFundamentalsDeferred() {
  const ds = buildDecisions({
    positions: [{ ticker: "RY.TO", qty: 50, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {}, // missing
  });
  const d = ds[0];
  assert(d?.action === ACTION.DEFERRED,
    "4. INCOME with missing fundamentals → DEFERRED (not silent HOLD)",
    `got action=${d?.action}`);
  assert(d?.evidenceFreshness === FRESHNESS.STALE,
    "4b. Deferred decision reports STALE evidence freshness");
}

function test5_incomePayoutRatioAboveCutTriggersSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "T.TO", qty: 200, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "T.TO": { ok: true, payoutRatio: 0.95, fcfYieldPct: 4.0, dividendYieldPct: 6.0 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.SELL,
    "5. INCOME with payout ratio 95% → SELL",
    `got action=${d?.action} reason=${d?.reason}`);
  assert(d?.shares === 200,
    "5b. INCOME SELL is full-position");
}

function test6_incomePayoutRatioWarnTriggersTrim() {
  const ds = buildDecisions({
    positions: [{ ticker: "BNS.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "BNS.TO": { ok: true, payoutRatio: 0.72, fcfYieldPct: 3.5 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.TRIM,
    "6. INCOME with payout ratio 72% (>65%, <90%) → TRIM",
    `got action=${d?.action}`);
  assert(d?.shares > 0 && d?.shares < 100,
    "6b. TRIM shares less than full position");
}

function test7_incomeNegativeFcfYieldTriggersSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "MO", qty: 50, ccy: "USD", account: "Non-Spousal" }],
    fundamentalsByTicker: {
      "MO": { ok: true, payoutRatio: 0.60, fcfYieldPct: -1.5 },
    },
  });
  assert(ds[0]?.action === ACTION.SELL,
    "7. INCOME with negative FCF yield → SELL (dividend uncovered by cash flow)");
}

function test8_incomeHealthyThesisHolds() {
  const ds = buildDecisions({
    positions: [{ ticker: "JNJ", qty: 30, ccy: "USD", account: "RRSP" }],
    fundamentalsByTicker: {
      "JNJ": { ok: true, payoutRatio: 0.45, fcfYieldPct: 5.8, dividendYieldPct: 3.1 },
    },
    revisionsByTicker: {
      "JNJ": { ok: true, epsRev4wPct: +2.0 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "8. INCOME with healthy payout + positive FCF + stable revs → HOLD");
  assert(d?.nextReview?.type === "earnings",
    "8b. INCOME HOLD review is event-driven (earnings)");
}

// ─── SWING ───────────────────────────────────────────────────────────
function test9_swingHardStopHitTriggersSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "TSLA", qty: 20, ccy: "USD", account: "Non-Spousal" }],
    monitor: {
      hardStopHit: [{ ticker: "TSLA", pnlPct: -9.5, hardStopPct: -8, account: "Non-Spousal" }],
      withinStop: [],
    },
  });
  assert(ds[0]?.action === ACTION.SELL,
    "9. SWING with hard-stop-hit → SELL");
}

function test10_swingHorizonExpiredTriggersSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "AMD", qty: 30, ccy: "USD", account: "Non-Spousal" }],
    monitor: { hardStopHit: [], withinStop: [] },
    horizonByTicker: {
      "AMD": { daysElapsed: 45, horizonDays: 30, status: "well-behind" },
    },
  });
  assert(ds[0]?.action === ACTION.SELL,
    "10. SWING with expired horizon + well-behind → SELL (time stop)");
}

function test11_swingSectorHostileTrim() {
  const ds = buildDecisions({
    positions: [{ ticker: "NVDA", qty: 20, ccy: "USD", account: "Non-Spousal" }],
    monitor: { hardStopHit: [], withinStop: [] },
    sectorRankByTicker: {
      "NVDA": { sector: "Technology", hostile: true, rank: 9 },
    },
  });
  assert(ds[0]?.action === ACTION.TRIM,
    "11. SWING with sector newly in bottom-3 → TRIM");
}

// ─── SPEC ────────────────────────────────────────────────────────────
function test12_specLatentWarningNoOverrideExits() {
  const ds = buildDecisions({
    positions: [{ ticker: "GME", qty: 100, ccy: "USD", account: "Non-Spousal" }],
    monitor: {
      hardStopHit: [],
      withinStop: [{ ticker: "GME", pnlPct: -6.5 }],
    },
    revisionsByTicker: {},
    upcomingCatalystByTicker: {},
  });
  const d = ds[0];
  assert(d?.sleeve === "spec",
    "12-pre. SPEC-classified ticker gets spec sleeve");
  assert(d?.action === ACTION.SELL,
    "12. SPEC with latent warning + no qualifying override → SELL",
    `got action=${d?.action}`);
}

function test13_specWithFreshCatalystOverrideHolds() {
  const ds = buildDecisions({
    positions: [{ ticker: "GME", qty: 100, ccy: "USD", account: "Non-Spousal" }],
    monitor: {
      hardStopHit: [],
      withinStop: [{ ticker: "GME", pnlPct: -6.5 }],
    },
    upcomingCatalystByTicker: {
      "GME": { daysAhead: 3, kind: "earnings" },
    },
  });
  assert(ds[0]?.action === ACTION.HOLD,
    "13. SPEC with fresh catalyst override → HOLD");
}

// ─── NEW OPPORTUNITY ─────────────────────────────────────────────────
function test14_qualifyingPickBecomesBuy() {
  const ds = buildDecisions({
    positions: [],
    dailyPicks: [
      { ticker: "MSFT", currency: "USD", compositeRank: 87, nominationCount: 5,
        entryPrice: 420, stopPrice: 380, targetPrice: 480, mtfConfluence: "aligned" },
    ],
  });
  const d = ds[0];
  assert(d?.action === ACTION.BUY,
    "14. Qualifying pick becomes BUY decision");
  assert(d?.confidence === CONFIDENCE.HIGH,
    "14b. Composite ≥85 → HIGH confidence");
}

function test15_blockedPickIsIgnored() {
  const ds = buildDecisions({
    positions: [],
    dailyPicks: [
      { ticker: "BAD", currency: "USD", compositeRank: 80, blockedReason: "concentration-cap" },
    ],
  });
  assert(ds.length === 0,
    "15. Blocked pick produces no BUY decision");
}

// ─── Renderer ────────────────────────────────────────────────────────
function test16_rendererDominantNoActionState() {
  const md = renderDecisionCard([
    { ticker: "XEQT.TO", sleeve: "core", action: ACTION.HOLD, reason: "core-mandate-intact", validated: true },
    { ticker: "JNJ", sleeve: "income", action: ACTION.HOLD, reason: "income-thesis-intact", validated: true },
  ]);
  assert(md.includes("## 🎯 TODAY'S DECISIONS"),
    "16. Renderer emits TODAY'S DECISIONS header");
  assert(md.includes("### 🟢 NO TRADES REQUIRED TODAY"),
    "16b. Dominant NO TRADES REQUIRED state when nothing actionable");
  assert(!md.includes("### 🔴") && !md.includes("### 🟡") && !md.includes("### 🔵"),
    "16c. No actionable per-position cards when all are HOLD");
}

function test17_rendererActionableAtTop() {
  const md = renderDecisionCard([
    { ticker: "XEQT.TO", sleeve: "core", action: ACTION.HOLD, reason: "hold", validated: true },
    { ticker: "DJT", sleeve: "spec", action: ACTION.SELL, shares: 234, whyNow: "SPEC exit — no override.",
      reason: "spec-latent-warning-no-override", confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH, validated: true },
  ]);
  const sellIdx = md.indexOf("DJT");
  const holdIdx = md.indexOf("XEQT.TO");
  assert(sellIdx > -1 && (holdIdx === -1 || sellIdx < holdIdx),
    "17. Actionable SELL renders BEFORE HOLD list");
  assert(md.includes("🔴 DJT — SELL 234 sh"),
    "17b. SELL card includes badge + share count");
  assert(md.includes("**Why now:**"),
    "17c. SELL card carries WHY NOW line");
}

function test18_rendererValidationBadge() {
  const md = renderDecisionCard([
    { ticker: "AAPL", sleeve: "swing", action: ACTION.BUY, shares: 10,
      whyNow: "test", reason: "qualifying-pick", confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH, validated: false,
      validationFailures: ["no companion mandate rec"] },
  ]);
  assert(md.includes("NOT VALIDATED"),
    "18. Un-validated actionable card renders NOT VALIDATED warning");
}

function test19_rendererDeferredIsSurfaced() {
  const md = renderDecisionCard([
    { ticker: "RY.TO", sleeve: "income", action: ACTION.DEFERRED,
      reason: "insufficient-evidence: fundamentals unavailable",
      whyNow: "Deferred: cannot evaluate dividend safety.",
      confidence: CONFIDENCE.LOW, evidenceFreshness: FRESHNESS.STALE, validated: true },
  ]);
  assert(md.includes("ACTION DEFERRED — DATA INSUFFICIENT"),
    "19. DEFERRED decision surfaces distinct label");
}

// ─── Integration hooks ──────────────────────────────────────────────
function test20_briefingImportsAndCallsEngine() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/import \{ buildDecisions, ACTION as DECISION_ACTION \} from "\.\.\/services\/stocksDecisionEngine\.js"/.test(src),
    "20. Briefing imports buildDecisions + ACTION alias");
  assert(/import \{ renderDecisionCard.*\} from "\.\.\/services\/stocksDecisionRenderer\.js"/.test(src),
    "20b. Briefing imports renderDecisionCard");
  assert(src.includes("[decision-engine]"),
    "20c. Briefing logs decision-engine invocations");
  assert(src.includes("decisionCardPrefix + deterministicPrefix"),
    "20d. Decision card is prepended ABOVE the deterministic prefix");
}

function test21_contradictionGatePresent() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(src.includes("contradicts-deterministic-hold"),
    "21. AI-contradiction gate rejects rec when engine says HOLD");
  assert(src.includes("contradicts-deterministic-exit"),
    "21b. AI-contradiction gate rejects BUY when engine says SELL/TRIM");
  assert(src.includes("contradicts-deterministic-deferred"),
    "21c. AI-contradiction gate rejects any rec on a DEFERRED ticker");
  assert(src.includes("[decision-contradict-gate]"),
    "21d. Contradiction gate logs a warn");
}

function run() {
  console.log("\n═══ P1 Decision Engine + Card Renderer Regression ═══\n");
  test1_coreDefaultHold();
  test2_coreConcentrationTriggersTrim();
  test3_coreTacticalDrawdownDoesNotSell();
  test4_incomeMissingFundamentalsDeferred();
  test5_incomePayoutRatioAboveCutTriggersSell();
  test6_incomePayoutRatioWarnTriggersTrim();
  test7_incomeNegativeFcfYieldTriggersSell();
  test8_incomeHealthyThesisHolds();
  test9_swingHardStopHitTriggersSell();
  test10_swingHorizonExpiredTriggersSell();
  test11_swingSectorHostileTrim();
  test12_specLatentWarningNoOverrideExits();
  test13_specWithFreshCatalystOverrideHolds();
  test14_qualifyingPickBecomesBuy();
  test15_blockedPickIsIgnored();
  test16_rendererDominantNoActionState();
  test17_rendererActionableAtTop();
  test18_rendererValidationBadge();
  test19_rendererDeferredIsSurfaced();
  test20_briefingImportsAndCallsEngine();
  test21_contradictionGatePresent();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run();
