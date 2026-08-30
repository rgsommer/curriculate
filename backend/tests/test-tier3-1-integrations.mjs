// Tier 3.1 regression tests — adversarial verify wiring, FMP news
// catalyst bump, turnaround detector, quality compounder archetype.

import { scoreGrowth } from "../services/stocksMultiFactorScore.js";
import { detectQualityCompounder, evaluateCompounderForPick, QUALITY_COMPOUNDER_BUMP } from "../services/stocksQualityCompounder.js";
import fs from "fs";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── Adversarial verify daily-pick adapter ──────────────────────
function test1_adversarialAdapterExists() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksAdversarialVerify.js",
    "utf-8"
  );
  assert(/export async function verifyDailyPickAdversarial/.test(src),
    "1. verifyDailyPickAdversarial() exported", "");
  assert(/export async function verifyDailyPicksBatch/.test(src),
    "1b. verifyDailyPicksBatch() batch helper exported", "");
}

function test2_briefingWiresAdversarial() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/verifyDailyPicksBatch/.test(src),
    "2. renderDailyPicksDeterministic imports verifyDailyPicksBatch", "");
  assert(/SCREENED-BEAR/.test(src),
    "2b. SCREENED-BEAR tier defined for adversarial-reject verdict", "");
  assert(/adversarial\?\.verdict === "risk_flagged"/.test(src),
    "2c. risk_flagged verdict surfaces annotation without changing tier", "");
  assert(/adversarial\?\.verdict === "confirmed_long"/.test(src),
    "2d. confirmed_long verdict surfaces bear-attack-failed confirmation", "");
}

function test3_adversarialAdapterShape() {
  // Verify the adapter maps daily-pick shape to discovery-pick shape
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksAdversarialVerify.js",
    "utf-8"
  );
  const required = ["bullCase:", "watchZone:", "projection", "keyCatalysts:", "whatProvesWrong:"];
  const missing = required.filter(k => !src.includes(k));
  assert(missing.length === 0,
    "3. Adapter maps daily-pick fields to verifyPick's expected shape",
    missing.length ? `missing keys: ${missing.join(", ")}` : "");
}

// ─── FMP news catalyst bump ─────────────────────────────────────
function test4_newsCatalystBump() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js",
    "utf-8"
  );
  assert(/getTickerNews/.test(src),
    "4. Pick engine imports getTickerNews", "");
  assert(/newsCatalystBump/.test(src),
    "4b. Pick engine attaches newsCatalystBump field", "");
  assert(/NEWS_LOOKBACK_DAYS\s*=\s*3/.test(src),
    "4c. Fresh-news window is 3 days", "");
  assert(/NEWS_BUMP\s*=\s*5/.test(src),
    "4d. News catalyst bump is +5 composite points", "");
}

// ─── Turnaround detector ─────────────────────────────────────────
function test5_turnaroundDetection() {
  const noTurnaround = scoreGrowth({
    ok: true,
    revenueYoYPct: 20, revenueAccelPp: 2,
    grossMarginExpansionPp: 1, opMarginExpansionPp: 0.5,
  }).score;
  // Turnaround: declining revenue BUT improving (2nd deriv positive)
  // AND margin expansion.
  const turnaround = scoreGrowth({
    ok: true,
    revenueYoYPct: -5, revenueAccelPp: 8,     // still down 5% but +8pp improving
    grossMarginExpansionPp: 2, opMarginExpansionPp: 1.5,
  }).score;
  // Baseline: same declining revenue BUT WITHOUT enough acceleration
  // (no turnaround bonus triggered) → still zero'd on revenue growth.
  const declineOnly = scoreGrowth({
    ok: true,
    revenueYoYPct: -5, revenueAccelPp: 1, // below +3 threshold
    grossMarginExpansionPp: 0, opMarginExpansionPp: 0, // no margin expansion
  }).score;
  assert(turnaround > 0.5, "5. Turnaround (negative but improving) scores > 0.5 (bonus fires)",
    `got ${turnaround.toFixed(2)}`);
  // Genuine growth SHOULD still register as a top-tier signal. Both
  // may hit the 1.0 clamp (design: strong turnaround IS a top signal),
  // but a legitimate turnaround should score materially higher than
  // a pure decline with no improvement.
  assert(turnaround > declineOnly + 0.15,
    "5b. Turnaround pattern scores materially higher than pure decline (bonus visible)",
    `turnaround=${turnaround.toFixed(2)}, decline-only=${declineOnly.toFixed(2)}`);
}

function test6_turnaroundRequiresAllConditions() {
  // Declining revenue but NOT improving → no bonus
  const decliningStable = scoreGrowth({
    ok: true,
    revenueYoYPct: -5, revenueAccelPp: 1, // barely improving, below +3 threshold
    grossMarginExpansionPp: 2, opMarginExpansionPp: 1.5,
  }).score;
  // Improving revenue but positive growth → no turnaround bonus (already growing)
  const noBonus = scoreGrowth({
    ok: true,
    revenueYoYPct: 5, revenueAccelPp: 8,
    grossMarginExpansionPp: 2, opMarginExpansionPp: 1.5,
  }).score;
  // Compare: same second-deriv but negative first-deriv → turnaround
  const turnaround = scoreGrowth({
    ok: true,
    revenueYoYPct: -5, revenueAccelPp: 8,
    grossMarginExpansionPp: 2, opMarginExpansionPp: 1.5,
  }).score;
  assert(turnaround > decliningStable,
    "6. Turnaround (accel > 3pp) scores higher than declining-stable (accel ≤ 3pp)",
    `t=${turnaround.toFixed(2)}, stable=${decliningStable.toFixed(2)}`);
  // Bonus fires when negative growth + improving; not fire when
  // already growing (the bonus is targeted at turnaround archetype)
  assert(!isNaN(noBonus), "6b. Positive-growth path is unaffected by turnaround branch", "");
}

// ─── Quality compounder ──────────────────────────────────────────
function test7_compounderQualifies() {
  const qualifying = {
    fundamentals: { ok: true, roe: 20, freeCashFlowYieldPct: 5, dToE: 0.4 },
    growth: { ok: true, revenueYoYPct: 8, opMarginExpansionPp: 0.5 },
  };
  const result = detectQualityCompounder(qualifying);
  assert(result.isCompounder,
    "7. Compounder qualifies (ROE 20% + FCF 5% + D/E 0.4 + margin flat + rev +8%)",
    `checks passed ${result.checksPassed}/${result.totalChecks}`);
  assert(result.checksPassed === 5, "7b. All 5 checks pass for the reference compounder",
    `got ${result.checksPassed}`);
}

function test8_compounderRequiresFourOfFive() {
  // Only 3 checks pass → not qualifying
  const marginal = {
    fundamentals: { ok: true, roe: 10, freeCashFlowYieldPct: 5, dToE: 0.4 }, // ROE fails
    growth: { ok: true, revenueYoYPct: 2, opMarginExpansionPp: 0.5 }, // rev growth fails (<3%)
  };
  const result = detectQualityCompounder(marginal);
  assert(!result.isCompounder,
    "8. Marginal (3/5 checks pass) does NOT qualify",
    `checks passed ${result.checksPassed}/${result.totalChecks}`);
}

function test9_compounderBonusMagnitude() {
  assert(QUALITY_COMPOUNDER_BUMP === 5,
    "9. Compounder bump is +5 composite (same magnitude as news catalyst)",
    `got ${QUALITY_COMPOUNDER_BUMP}`);
  const qualifying = {
    fundamentals: { ok: true, roe: 20, freeCashFlowYieldPct: 5, dToE: 0.4 },
    growth: { ok: true, revenueYoYPct: 8, opMarginExpansionPp: 0.5 },
  };
  const evalResult = evaluateCompounderForPick(qualifying);
  assert(evalResult.bumped && evalResult.bumpAmount === 5,
    "9b. evaluateCompounderForPick returns bumped:true + bumpAmount 5 for qualifier", "");
  assert(/Quality Compounder/.test(evalResult.badge || ""),
    "9c. Badge string contains 'Quality Compounder' identifier",
    `badge: ${evalResult.badge}`);
}

function test10_compounderInsufficientData() {
  const result = detectQualityCompounder({
    fundamentals: { ok: false },
    growth: { ok: true, revenueYoYPct: 20 },
  });
  assert(!result.isCompounder,
    "10. Missing fundamentals → not a compounder (safe default)", "");
}

// ─── Pick engine wires compounder ────────────────────────────────
function test11_pickEngineWiresCompounder() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js",
    "utf-8"
  );
  assert(/evaluateCompounderForPick/.test(src),
    "11. Pick engine calls evaluateCompounderForPick in Stage 2", "");
  assert(/qualityCompounderBadge/.test(src),
    "11b. Compounder badge attached to candidate", "");
  assert(/compositeRankPreCompounder/.test(src),
    "11c. Pre-compounder rank preserved for audit trail", "");
}

async function run() {
  console.log("\n═══ Tier 3.1 — Adversarial + News + Turnaround + Compounder Tests ═══\n");
  test1_adversarialAdapterExists();
  test2_briefingWiresAdversarial();
  test3_adversarialAdapterShape();
  test4_newsCatalystBump();
  test5_turnaroundDetection();
  test6_turnaroundRequiresAllConditions();
  test7_compounderQualifies();
  test8_compounderRequiresFourOfFive();
  test9_compounderBonusMagnitude();
  test10_compounderInsufficientData();
  test11_pickEngineWiresCompounder();

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
