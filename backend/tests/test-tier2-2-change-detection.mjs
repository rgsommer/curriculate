// Tier 2.2 regression tests — change-detection signals (audit Aug-28).
// EPS acceleration, margin expansion, FCF conversion trend, RS
// acceleration, insider cluster velocity — every 2nd-derivative signal
// the audit identified as missing.

import { scoreGrowth, scoreRelativeStrength, scoreInsider, computeMultiFactorScore } from "../services/stocksMultiFactorScore.js";
import fs from "fs";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── EPS acceleration ───────────────────────────────────────────
function test1_epsAccelPositiveScoresHigh() {
  const noAccel = scoreGrowth({ ok: true, epsAccelPp: 0 });
  const strongAccel = scoreGrowth({ ok: true, epsAccelPp: 8 });
  assert(strongAccel.score > noAccel.score,
    "1. Positive EPS acceleration (+8pp) scores higher than flat",
    `flat=${noAccel.score.toFixed(2)}, accel=${strongAccel.score.toFixed(2)}`);
}

function test2_epsDecelPenalized() {
  const strongDecel = scoreGrowth({ ok: true, epsAccelPp: -8 });
  assert(strongDecel.score < 0.5,
    "2. EPS deceleration (−8pp) scores below neutral 0.5", `got ${strongDecel.score.toFixed(2)}`);
}

// ─── Margin expansion ───────────────────────────────────────────
function test3_grossMarginExpansionRewarded() {
  const noExp = scoreGrowth({ ok: true, grossMarginExpansionPp: 0 });
  const withExp = scoreGrowth({ ok: true, grossMarginExpansionPp: 3 });
  assert(withExp.score > noExp.score,
    "3. Gross margin expansion (+3pp) scores higher than flat",
    `flat=${noExp.score.toFixed(2)}, exp=${withExp.score.toFixed(2)}`);
}

function test4_opMarginExpansionSharperReward() {
  // Operating margin has a tighter threshold (+1.5pp = 1.0) so a
  // +2pp op margin expansion should already max out.
  const g = scoreGrowth({ ok: true, opMarginExpansionPp: 2 });
  assert(g.score >= 0.9,
    "4. Op margin expansion (+2pp) close to max reward",
    `got ${g.score.toFixed(2)}`);
}

function test5_marginCompressionPenalized() {
  const g = scoreGrowth({ ok: true, opMarginExpansionPp: -2 });
  assert(g.score < 0.5,
    "5. Op margin compression (−2pp) scored below neutral", `got ${g.score.toFixed(2)}`);
}

// ─── FCF conversion trend ───────────────────────────────────────
function test6_fcfConversionRising() {
  const flat = scoreGrowth({ ok: true, fcfConversionTrendPp: 0 });
  const rising = scoreGrowth({ ok: true, fcfConversionTrendPp: 3 });
  assert(rising.score > flat.score,
    "6. FCF conversion trend rising (+3pp) scores higher than flat",
    `flat=${flat.score.toFixed(2)}, rising=${rising.score.toFixed(2)}`);
}

// ─── Combined: strong-across-the-board inflection stock ─────────
function test7_multipleAcceleratorsCompound() {
  // A name accelerating on revenue, EPS, margin, AND FCF — should
  // score high on scoreGrowth (near 1.0 depending on the mix).
  const g = scoreGrowth({
    ok: true,
    revenueYoYPct: 50, revenueAccelPp: 5,
    epsYoYPct: 80,   epsAccelPp: 10,
    grossMarginExpansionPp: 3,
    opMarginExpansionPp: 2,
    fcfConversionTrendPp: 3,
  });
  assert(g.score >= 0.85,
    "7. Broad-based accelerating name scores near max (all 2nd derivs positive)",
    `got ${g.score.toFixed(2)}`);
}

// ─── RS acceleration ────────────────────────────────────────────
function test8_rsEmergenceBonus() {
  // 3M RS beats 6M RS by 10pp → strong emergence bonus.
  const plain = scoreRelativeStrength({ ok: true, rs1mPp: 5, rs3mPp: 5, rs6mPp: 5 });
  const emerging = scoreRelativeStrength({ ok: true, rs1mPp: 10, rs3mPp: 15, rs6mPp: 5 });
  assert(emerging.score > plain.score,
    "8. RS emergence (3M − 6M = +10pp) scores higher than flat RS",
    `plain=${plain.score.toFixed(2)}, emerging=${emerging.score.toFixed(2)}`);
  // Check the contributor line surfaces the bonus
  const hasBonusLine = (emerging.contributors || []).some(c => /emergence/i.test(c) && /bonus/i.test(c));
  assert(hasBonusLine, "8b. RS emergence bonus is surfaced in contributors", "");
}

function test9_rsScoreClampedToOne() {
  const maxed = scoreRelativeStrength({ ok: true, rs1mPp: 30, rs3mPp: 30, rs6mPp: 5 });
  assert(maxed.score <= 1.0,
    "9. RS score with bonus stays clamped ≤ 1.0", `got ${maxed.score.toFixed(2)}`);
}

// ─── Insider cluster velocity ───────────────────────────────────
function test10_insiderVelocityAccelBonus() {
  const flat = scoreInsider({ clusterBuy: true });
  const accel = scoreInsider({ clusterBuy: true, velocityDeltaPct: 60 });
  // clusterBuy already max score, velocity can't push past 1.0.
  // Show test: with clusterBuy false and velocity=+60, score should be 0.6.
  const noneAccel = scoreInsider({ clusterBuy: false, velocityDeltaPct: 60 });
  assert(noneAccel.score > 0.5,
    "10. Insider velocity +60% bonus even with no cluster (0.5 base + 0.10 = 0.60)",
    `got ${noneAccel.score.toFixed(2)}`);
  assert(accel.score === 1.0 || accel.score === flat.score,
    "10b. Velocity bonus caps at 1.0 (clusterBuy already max)", `got ${accel.score.toFixed(2)}`);
}

function test11_insiderVelocityCoolingPenalty() {
  const cooling = scoreInsider({ clusterBuy: false, velocityDeltaPct: -60 });
  assert(cooling.score < 0.5,
    "11. Insider velocity −60% penalty (cooling conviction)", `got ${cooling.score.toFixed(2)}`);
}

function test12_insiderVelocityMildIgnored() {
  const mild = scoreInsider({ clusterBuy: false, velocityDeltaPct: 15 });
  assert(Math.abs(mild.score - 0.5) < 0.01,
    "12. Insider velocity ±15% is treated as noise (no bonus)", `got ${mild.score.toFixed(2)}`);
}

// ─── Source-code presence checks (belt & braces) ────────────────
function test13_getGrowthEmitsNewFields() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksGrowthRevisions.js", "utf-8");
  const required = ["epsAccelPp", "grossMarginExpansionPp", "opMarginExpansionPp", "fcfConversionTrendPp"];
  const missing = required.filter(k => !src.includes(k));
  assert(missing.length === 0,
    "13. getGrowth now returns EPS accel, margin expansion, FCF conversion trend",
    missing.length ? `missing: ${missing.join(", ")}` : "");
}

function test14_insiderClusterVelocityFunctionExported() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksInsiderSignals.js", "utf-8");
  assert(/export\s+async\s+function\s+getInsiderClusterVelocity/.test(src),
    "14. getInsiderClusterVelocity exported from stocksInsiderSignals.js", "");
}

function test15_pickEngineWiresVelocity() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(/getInsiderClusterVelocity/.test(src),
    "15. Pick engine imports and calls getInsiderClusterVelocity", "");
  assert(/velocityDeltaPct/.test(src),
    "15b. Pick engine folds velocityDeltaPct into insider bucket", "");
}

// ─── Multi-factor composite still runs end-to-end ───────────────
function test16_compositeStillRuns() {
  const cs = computeMultiFactorScore({
    technicalScore: 75,
    fundamentals: { ok: true, pe: 30, roe: 20, dToE: 0.5, freeCashFlowYieldPct: 3 },
    growth: {
      ok: true,
      revenueYoYPct: 40, revenueAccelPp: 3,
      epsYoYPct: 50, epsAccelPp: 5,
      grossMarginExpansionPp: 2, opMarginExpansionPp: 1.5,
      fcfConversionTrendPp: 2,
    },
    revisions: { epsRev4wPct: 4 },
    rs: { ok: true, rs1mPp: 8, rs3mPp: 15, rs6mPp: 5 },
    insider: { clusterBuy: true, velocityDeltaPct: 40 },
  });
  assert(Number.isFinite(cs?.score) && cs.score >= 0 && cs.score <= 100,
    "16. computeMultiFactorScore still returns valid 0-100 composite with all new fields",
    `got ${cs?.score}`);
  assert(cs.score >= 70,
    "16b. Strong composite with acceleration everywhere ≥ 70", `got ${cs.score}`);
}

async function run() {
  console.log("\n═══ Tier 2.2 — Change-Detection Signal Regression Tests ═══\n");
  test1_epsAccelPositiveScoresHigh();
  test2_epsDecelPenalized();
  test3_grossMarginExpansionRewarded();
  test4_opMarginExpansionSharperReward();
  test5_marginCompressionPenalized();
  test6_fcfConversionRising();
  test7_multipleAcceleratorsCompound();
  test8_rsEmergenceBonus();
  test9_rsScoreClampedToOne();
  test10_insiderVelocityAccelBonus();
  test11_insiderVelocityCoolingPenalty();
  test12_insiderVelocityMildIgnored();
  test13_getGrowthEmitsNewFields();
  test14_insiderClusterVelocityFunctionExported();
  test15_pickEngineWiresVelocity();
  test16_compositeStillRuns();

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
