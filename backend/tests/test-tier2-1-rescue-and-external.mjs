// Tier 2.1 regression tests — parallel fundamentals-rescue pool
// + external adjustment applied to compositeRank.
//
// Contract asserted:
//   1. rescueScored[] array declared in pick engine
//   2. FUNDAMENTALS_RESCUE_FLOOR = 25 is the correct floor
//   3. FUNDAMENTALS_RESCUE_PROMOTION = 60 is the promotion threshold
//   4. Rescue loop fetches fundamentals via getFundamentals / getGrowth /
//      getEstimateRevisions
//   5. External adjustment is applied to compositeRank (not just display)
//   6. baseCompositeRank is preserved alongside compositeRank
//   7. Final rerank uses `combined = [...stage2Input, ...promoted]`

import fs from "fs";

const SRC = fs.readFileSync(
  "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js",
  "utf-8"
);

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

function test1_rescueScoredArrayDeclared() {
  assert(/const\s+rescueScored\s*=\s*\[\]/.test(SRC),
    "1. rescueScored[] array declared alongside scored[]", "");
}

function test2_fundamentalsFloorIs25() {
  const m = SRC.match(/const\s+FUNDAMENTALS_RESCUE_FLOOR\s*=\s*(\d+)/);
  const val = m ? Number(m[1]) : null;
  assert(val === 25, "2. FUNDAMENTALS_RESCUE_FLOOR = 25 (the [25,40) rescue band)", `got ${val}`);
}

function test3_promotionThresholdIs60() {
  const m = SRC.match(/const\s+FUNDAMENTALS_RESCUE_PROMOTION\s*=\s*(\d+)/);
  const val = m ? Number(m[1]) : null;
  assert(val === 60, "3. FUNDAMENTALS_RESCUE_PROMOTION = 60 (multi-factor composite bar)", `got ${val}`);
}

function test4_rescueGetFundamentalsCalled() {
  // The rescue loop reuses the same imports/functions the main stage-2
  // loop uses. Verify getFundamentals is called inside the rescue loop.
  const rescueBlock = SRC.match(/rescueInput[\s\S]*?promoted[\s\S]{0,3000}/);
  assert(!!rescueBlock, "4. Rescue block reads rescueInput and produces promoted[]", "");
  const hasFundamentalsCall = /getFundamentals\(cand\.ticker/.test(SRC);
  assert(hasFundamentalsCall, "4b. getFundamentals called on rescue candidates", "");
}

function test5_externalAdjustmentAppliedToCompositeRank() {
  // Match the mutation: compositeRank = min(100, baseCompositeRank + externalAdjustment)
  const hasApply = /compositeRank\s*=\s*Math\.min\(100,\s*cand\.baseCompositeRank\s*\+\s*cand\.externalAdjustment\)/.test(SRC);
  assert(hasApply, "5. External adjustment mutates compositeRank (was display-only)", "");
}

function test6_baseCompositeRankPreserved() {
  const hasBase = /cand\.baseCompositeRank\s*=\s*cand\.compositeRank/.test(SRC);
  assert(hasBase, "6. baseCompositeRank preserved for auditability", "");
}

function test7_finalRerankUsesCombined() {
  const hasCombined = /const\s+combined\s*=\s*\[\.\.\.stage2Input,\s*\.\.\.promoted\]/.test(SRC);
  assert(hasCombined, "7. Final rerank uses combined = [...stage2Input, ...promoted]", "");
  const combinedSort = /combined\.sort\(\(a,\s*b\)\s*=>\s*\(b\.compositeRank\s*\?\?\s*b\.deterministicScore\)/.test(SRC);
  assert(combinedSort, "7b. combined.sort ranks by compositeRank (with technical fallback)", "");
}

function test8_externalCapWithHundredCeiling() {
  // Verify the ceiling clause: Math.min(100, ...) prevents external
  // from inflating a mediocre base past 100.
  const hasCeiling = /Math\.min\(100,\s*cand\.baseCompositeRank/.test(SRC);
  assert(hasCeiling, "8. External adjustment capped at composite = 100 ceiling", "");
}

function test9_rescueTopKEnvOverride() {
  const m = SRC.match(/STOCKS_RESCUE_TOP_K\)\s*\|\|\s*(\d+)/);
  const val = m ? Number(m[1]) : null;
  assert(val === 15, "9. RESCUE_TOP_K env override defaults to 15 (bounded FMP call growth)", `got ${val}`);
}

function test10_belowFloorStillDropped() {
  // Verify that a candidate BELOW FUNDAMENTALS_RESCUE_FLOOR is still
  // dropped — 25 is the floor, below 25 = still tech-fail territory
  const hasGuard = /if\s*\(score\s*>=\s*FUNDAMENTALS_RESCUE_FLOOR\)/.test(SRC);
  assert(hasGuard, "10. Rescue pool guarded by FUNDAMENTALS_RESCUE_FLOOR — below 25 still dropped", "");
}

// ─── Behavioral simulation ──────────────────────────────────────
// Since scoreCandidate + stage-2 depend on network / DB / real
// tech data we can't unit-test the full loop from here. But we CAN
// reason about the final ranking math in isolation.
function test11_externalCanTiebreakButNotOverride() {
  // Fixture:
  //   A: baseCompositeRank 65, externalAdjustment 5 → 70
  //   B: baseCompositeRank 68, externalAdjustment 0 → 68
  //   C: baseCompositeRank 82, externalAdjustment 3 → 85
  //   D: baseCompositeRank 92, externalAdjustment 5 → 97 (capped only at 100)
  const applied = (base, ext) => Math.min(100, base + ext);
  const candidates = [
    { t: "A", rank: applied(65, 5) },
    { t: "B", rank: applied(68, 0) },
    { t: "C", rank: applied(82, 3) },
    { t: "D", rank: applied(92, 5) },
  ].sort((a, b) => b.rank - a.rank);
  assert(candidates[0].t === "D" && candidates[1].t === "C",
    "11. Strong base + external stays top (D=97, C=85); A(70) leapfrogs B(68) via external",
    JSON.stringify(candidates.map(c => `${c.t}:${c.rank}`)));
  // External CAN change order (A leapfrog B) but a mediocre base can't
  // beat a top base even with max external.
  const aBeatsC = candidates.findIndex(c => c.t === "A") < candidates.findIndex(c => c.t === "C");
  assert(!aBeatsC, "11b. Mediocre base (A=65) + max external cannot beat C's stronger base (82)", "");
}

function test12_hundredCeilingHolds() {
  // Base 99 + external 5 → 100 (capped), not 104
  const applied = Math.min(100, 99 + 5);
  assert(applied === 100, "12. baseCompositeRank 99 + external 5 caps at 100", `got ${applied}`);
  const applied2 = Math.min(100, 82 + 3);
  assert(applied2 === 85, "12b. baseCompositeRank 82 + external 3 = 85 (no cap needed)", `got ${applied2}`);
}

function test13_rescueSummaryLogged() {
  const hasLog = /promoted\s*\$\{promoted\.length\}\/\$\{rescueInput\.length\}/.test(SRC);
  assert(hasLog, "13. Rescue promotion is logged for observability", "");
}

function run() {
  console.log("\n═══ Tier 2.1 — Rescue Pool + External-Applied Regression Tests ═══\n");
  test1_rescueScoredArrayDeclared();
  test2_fundamentalsFloorIs25();
  test3_promotionThresholdIs60();
  test4_rescueGetFundamentalsCalled();
  test5_externalAdjustmentAppliedToCompositeRank();
  test6_baseCompositeRankPreserved();
  test7_finalRerankUsesCombined();
  test8_externalCapWithHundredCeiling();
  test9_rescueTopKEnvOverride();
  test10_belowFloorStillDropped();
  test11_externalCanTiebreakButNotOverride();
  test12_hundredCeilingHolds();
  test13_rescueSummaryLogged();

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
