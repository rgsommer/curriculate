// Tier 3.2 regression tests — moonshot append + chart-vision veto.

import { chartVisionVetoVerdict } from "../services/stocksChartVision.js";
import { formatMoonshotBriefingBlock, calibrateProbabilities } from "../services/stocksMoonshot.js";
import fs from "fs";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── chartVisionVetoVerdict ────────────────────────────────────
function test1_stage3TopVetos() {
  const v = chartVisionVetoVerdict({ trendStage: "stage-3 top", conviction: "medium", patterns: [] });
  assert(v.veto === true && !v.softWarning, "1. stage-3 top → veto", `got ${JSON.stringify(v)}`);
}

function test2_stage4DeclineVetos() {
  const v = chartVisionVetoVerdict({ trendStage: "stage-4 decline", conviction: "high", patterns: [] });
  assert(v.veto === true, "2. stage-4 decline → veto (regardless of conviction)", "");
}

function test3_bearishPatternPlusLowConviction() {
  const v = chartVisionVetoVerdict({
    trendStage: "stage-2 markup",
    conviction: "low",
    patterns: ["head-and-shoulders"],
  });
  assert(v.veto === true, "3. Bearish pattern + low conviction → veto", "");
}

function test4_softWarningOnLowConviction() {
  const v = chartVisionVetoVerdict({
    trendStage: "stage-2 markup",
    conviction: "low",
    patterns: ["bull flag"],
    convictionReason: "unclear pattern",
  });
  assert(v.veto === false && v.softWarning === true,
    "4. Low conviction alone → soft warning (no veto)", `got ${JSON.stringify(v)}`);
}

function test5_softWarningOnBearishPattern() {
  const v = chartVisionVetoVerdict({
    trendStage: "stage-2 markup",
    conviction: "high",
    patterns: ["double top"],
  });
  assert(v.veto === false && v.softWarning === true,
    "5. Bearish pattern + high conviction → soft warning (not veto)", `got ${JSON.stringify(v)}`);
}

function test6_healthyBullish() {
  const v = chartVisionVetoVerdict({
    trendStage: "stage-2 markup",
    conviction: "high",
    patterns: ["bull flag", "vcp"],
  });
  assert(v.veto === false && v.softWarning === false,
    "6. Healthy uptrend + bullish patterns → no veto, no warning", "");
}

function test7_nullOrEmpty() {
  const v1 = chartVisionVetoVerdict(null);
  const v2 = chartVisionVetoVerdict({});
  assert(v1.veto === false && v2.veto === false,
    "7. Null / empty analysis → safe default (no veto)", "");
}

// ─── Moonshot briefing format ──────────────────────────────────
function test8_formatMoonshotBlock() {
  const block = formatMoonshotBriefingBlock({
    pick: { ticker: "MNSHT", currencyAtDiscovery: "USD" },
    moonshot: {
      p5xPct: 25,
      p10xPct: 12,
      compositeScore: 72,
      thesisSummary: "AI-inference silicon spec that's supplying a hyperscaler",
      catalysts: ["Product launch Q1", "Design win with a major LP"],
      stopStrategy: "Break below $12 = thesis broken",
    },
    ageInDays: 3,
  });
  assert(block.includes("🚀 ASYMMETRIC"), "8. Format emits ASYMMETRIC label", "");
  assert(block.includes("MNSHT"), "8b. Includes ticker", "");
  assert(block.includes("P(5×) ≈ 25%"), "8c. Includes P(5x) calibrated %", "");
  assert(block.includes("P(10×) ≈ 12%"), "8d. Includes P(10x) calibrated %", "");
  assert(block.includes("lottery-ticket"), "8e. Enforces small-position discipline in copy", "");
}

function test9_moonshotWithoutProbsStillWorks() {
  const block = formatMoonshotBriefingBlock({
    pick: { ticker: "X", currencyAtDiscovery: null },
    moonshot: { compositeScore: 65, thesisSummary: "test" },
    ageInDays: 5,
  });
  assert(block && block.includes("X"), "9. Missing probabilities → block still renders", "");
}

function test10_calibratedProbCapsHold() {
  // calibrateProbabilities enforces P(5x)≤30, P(10x)≤15
  const { p5xPct, p10xPct } = calibrateProbabilities(80, 60);
  assert(p5xPct <= 30, "10. Calibrator caps P(5x) at 30", `got ${p5xPct}`);
  assert(p10xPct <= 15, "10b. Calibrator caps P(10x) at 15", `got ${p10xPct}`);
}

// ─── Wiring in stocksDailyBriefing.js ──────────────────────────
function test11_briefingWiresChartVision() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/getChartVisionAnalysis/.test(src),
    "11. renderDailyPicksDeterministic imports getChartVisionAnalysis", "");
  assert(/chartVisionVetoVerdict/.test(src),
    "11b. Uses chartVisionVetoVerdict helper", "");
  assert(/SCREENED-CHART/.test(src),
    "11c. SCREENED-CHART tier defined for vision veto", "");
  // Only top-1 gets vision — verify by looking for slice(0, 1)
  assert(/\.slice\(0, 1\)/.test(src),
    "11d. Only top-1 BUY candidate gets chart vision (cost-bounded)", "");
}

function test12_briefingWiresMoonshot() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/getLatestMoonshotForBriefing/.test(src),
    "12. renderDailyPicksDeterministic imports getLatestMoonshotForBriefing", "");
  assert(/formatMoonshotBriefingBlock/.test(src),
    "12b. Uses formatMoonshotBriefingBlock formatter", "");
  assert(/maxAgeDays:\s*14/.test(src),
    "12c. Moonshot freshness gate is 14 days", "");
}

// ─── Cost-boundedness ──────────────────────────────────────────
function test13_chartVisionCostBounded() {
  // Confirm we don't accidentally spawn N chart-vision calls
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  // A single getChartVisionAnalysis call inside renderDailyPicksDeterministic
  // (before the per-pick loop)
  const match = src.match(/getChartVisionAnalysis\(top\.ticker/g);
  assert(match && match.length === 1,
    "13. Chart vision called exactly once per briefing (top-1 only)",
    `found ${match?.length || 0} call(s)`);
}

async function run() {
  console.log("\n═══ Tier 3.2 — Moonshot Append + Chart-Vision Veto Tests ═══\n");
  test1_stage3TopVetos();
  test2_stage4DeclineVetos();
  test3_bearishPatternPlusLowConviction();
  test4_softWarningOnLowConviction();
  test5_softWarningOnBearishPattern();
  test6_healthyBullish();
  test7_nullOrEmpty();
  test8_formatMoonshotBlock();
  test9_moonshotWithoutProbsStillWorks();
  test10_calibratedProbCapsHold();
  test11_briefingWiresChartVision();
  test12_briefingWiresMoonshot();
  test13_chartVisionCostBounded();

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
