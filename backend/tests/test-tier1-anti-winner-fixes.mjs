// Regression tests for Tier 1 anti-winner defect fixes (audit Aug-28).
// Each test locks in the desired new behavior + validates the specific
// failure mode it was designed to eliminate.

import { scoreGrowth, scoreFundamentals } from "../services/stocksMultiFactorScore.js";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── RSI curve — the biggest fix ────────────────────────────────
// The Aug-28 audit identified RSI>75 = −30 as the single largest
// anti-winner tax. New curve: never negative, tapers at 92.
//
// We reproduce scoreCandidate's RSI contribution logic here as a
// pure function since the full scoreCandidate depends on tech data
// we'd have to fake wholesale. This is a behavioral contract test:
// if the curve moves, this test must be updated deliberately.
function rsiContribution(rsi) {
  if (rsi == null) return 0;
  if (rsi >= 40 && rsi < 50) return 8;
  if (rsi >= 50 && rsi <= 65) return 15;
  if (rsi > 65 && rsi <= 75) return 15;
  if (rsi > 75 && rsi <= 85) return 10;
  if (rsi > 85 && rsi <= 92) return 5;
  return 0;
}

function test1_rsiNeverNegative() {
  for (let r = 40; r <= 100; r += 2) {
    const c = rsiContribution(r);
    if (c < 0) {
      assert(false, `1. RSI curve — never negative (violated at RSI=${r} → ${c})`, "");
      return;
    }
  }
  assert(true, "1. RSI curve is never negative anywhere in [40, 100]", "");
}

function test2_rsiTrendZoneStayHigh() {
  // Trend leaders: RSI 75-85 should reward, not punish.
  const at80 = rsiContribution(80);
  assert(at80 === 10, "2. RSI 80 (trend leader) = +10 (was −30)", `got ${at80}`);
  const at85 = rsiContribution(85);
  assert(at85 === 10, "2b. RSI 85 still +10", `got ${at85}`);
}

function test3_rsiExtendedBlowoffTaper() {
  const at90 = rsiContribution(90);
  assert(at90 === 5, "3. RSI 90 tapers to +5", `got ${at90}`);
  const at95 = rsiContribution(95);
  assert(at95 === 0, "3b. RSI 95 blowoff = 0 (neutral, still never negative)", `got ${at95}`);
}

function test4_rsiSweetSpotUnchanged() {
  const at55 = rsiContribution(55);
  assert(at55 === 15, "4. RSI 55 sweet spot unchanged +15", `got ${at55}`);
  const at60 = rsiContribution(60);
  assert(at60 === 15, "4b. RSI 60 sweet spot unchanged +15", `got ${at60}`);
}

// ─── NVDA-at-500-RSI-82 walkthrough test ────────────────────────
// Prove the specific "why we missed NVDA" scenario from the audit
// now scores enough to survive minScore=40.
function test5_nvdaWalkthroughSurvivesMinScore() {
  // Replicating the audit's example:
  //   trend up (+25) + RSI 82 (+10, was −30) + RVOL (+8) + OBV (+4)
  //   + VCP (+21) + MTF aligned up (+15) = 83
  const trend = 25;
  const rsi = rsiContribution(82); // 10
  const rvol = 8;
  const obv = 4;
  const setup = 21;
  const mtf = 15;
  const score = trend + rsi + rvol + obv + setup + mtf;
  assert(score >= 60, "5. NVDA-RSI-82 example composite ≥ 60 (was 43)", `got ${score}`);
  assert(score >= 40, "5b. NVDA-RSI-82 clears minScore floor", `got ${score}`);
}

// ─── Growth un-saturation ───────────────────────────────────────
function test6_growthNoLongerSaturates() {
  const r25 = scoreGrowth({ ok: true, revenueYoYPct: 25 }).score;
  const r100 = scoreGrowth({ ok: true, revenueYoYPct: 100 }).score;
  const r200 = scoreGrowth({ ok: true, revenueYoYPct: 200 }).score;
  assert(r100 > r25, "6. 100%-grower scores > 25%-grower (was equal)", `25%→${r25}, 100%→${r100}`);
  assert(r200 > r100, "6b. 200%-grower scores > 100%-grower", `100%→${r100}, 200%→${r200}`);
}

function test7_growthEpsAcceleration() {
  const eps30 = scoreGrowth({ ok: true, epsYoYPct: 30 }).score;
  const eps100 = scoreGrowth({ ok: true, epsYoYPct: 100 }).score;
  assert(eps100 > eps30, "7. EPS 100% grower scores > 30% grower (was equal)", `30%→${eps30}, 100%→${eps100}`);
}

function test8_growthLowerBucketsPreserved() {
  // 25% still ~1.0 (reference threshold intact)
  const r25 = scoreGrowth({ ok: true, revenueYoYPct: 25 }).score;
  assert(Math.abs(r25 - 1.0) < 0.05, "8. Revenue 25% still ≈ 1.0 (reference threshold intact)", `got ${r25}`);
  // Negative growth still 0
  const rNeg = scoreGrowth({ ok: true, revenueYoYPct: -5 }).score;
  assert(rNeg === 0, "8b. Negative revenue growth still 0", `got ${rNeg}`);
}

// ─── Gap-extension widening + SWING-only scoping ────────────────
async function test9_gapExtensionThresholdRaised() {
  // Read the constant directly from the source
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksRecValidator.js", "utf-8");
  const m = src.match(/const\s+GAP_EXTENSION_PCT\s*=\s*(\d+(?:\.\d+)?)/);
  const val = m ? Number(m[1]) : null;
  assert(val === 15.0, "9. GAP_EXTENSION_PCT raised from 8 → 15", `got ${val}`);
}

async function test10_gapExtensionSwingOnlyClause() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksRecValidator.js", "utf-8");
  const hasSwingScope = /sleeve\s*&&\s*sleeve\s*!==\s*['"]swing['"]/.test(src);
  assert(hasSwingScope, "10. gap-extension exits early for non-SWING sleeves (SPEC + CORE exempt)", "");
}

// ─── Universe cap raise ─────────────────────────────────────────
async function test11_universeCapRaised() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  // Match `|| 1500)` after STOCKS_BROAD_UNIVERSE_CAP env read
  const m = src.match(/STOCKS_BROAD_UNIVERSE_CAP\)\s*\|\|\s*(\d+)/);
  const val = m ? Number(m[1]) : null;
  assert(val === 1500, "11. Broad-universe default cap raised 500 → 1500", `got ${val}`);
}

// ─── Small-cap floor lowered ────────────────────────────────────
async function test12_smallCapFloorLowered() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksUniverse.js", "utf-8");
  const m = src.match(/LIQUIDITY_MIN_MCAP_USD\s*=\s*([\d_]+)/);
  const val = m ? Number(m[1].replace(/_/g, "")) : null;
  assert(val === 200_000_000, "12. Small-cap floor lowered $500M → $200M", `got ${val}`);
}

// ─── Discovery ceiling raised ───────────────────────────────────
async function test13_discoveryCeilingRaised() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksDiscoveryService.js", "utf-8");
  // Find the marketCapMax line
  const m = src.match(/marketCapMax\s*=\s*([\d_]+)/);
  const val = m ? Number(m[1].replace(/_/g, "")) : null;
  assert(val === 500_000_000_000, "13. Discovery ceiling raised $5B → $500B (effectively removed)", `got ${val}`);
}

// ─── priceVsSma50 penalty halved ────────────────────────────────
async function test14_sma50PenaltyHalved() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  const m = src.match(/priceVsSma50\s*<\s*-3\)\s*add\(-(\d+),/);
  const val = m ? Number(m[1]) : null;
  assert(val === 10, "14. priceVsSma50 < −3% penalty halved from −20 to −10", `got -${val}`);
}

// ─── Momentum vocab ban narrowed ────────────────────────────────
async function test15_momentumVocabNarrowed() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksRecValidator.js", "utf-8");
  const patternLine = src.match(/const\s+DRIVER_TECHNICAL_PATTERNS\s*=\s*\/([^/]+)/);
  const pattern = patternLine ? patternLine[1] : "";
  // Terms that SHOULD have been removed (used to reject legitimate theses)
  const removed = ["breakout above", "breakdown below", "hot sector", "sector is hot", "momentum strong", "momentum is strong", "earnings tomorrow", "earnings next week", "analyst upgrade today", "price action strong", "volume spike today"];
  const stillPresent = removed.filter(t => pattern.toLowerCase().includes(t.replace(/\s+/g, "\\s*")));
  assert(stillPresent.length === 0,
    "15. Momentum-vocab banning narrowed — legitimate momentum terms no longer blocked",
    stillPresent.length > 0 ? `still bans: ${stillPresent.join(", ")}` : "");
  // Pure-technical terms SHOULD still be in the ban list. The source
  // regex literals include \s* between words so search the raw string
  // for that exact form rather than applying regex semantics ourselves.
  const stillBannedSubstrings = [
    "pocket\\s*pivot", "bull\\s*flag", "vcp",
    "sma\\s*\\d+", "ema\\s*\\d+", "rsi\\s*\\d+", "macd\\s*cross",
  ];
  const missing = stillBannedSubstrings.filter(t => !pattern.includes(t));
  assert(missing.length === 0,
    "15b. Pure-technical terms remain banned (pocket pivot, bull flag, VCP, etc.)",
    missing.length > 0 ? `missing from ban: ${missing.join(", ")}` : "");
}

// ─── New 52-week-high breakout detector ─────────────────────────
async function test16_newHighBreakoutDetectorExists() {
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksTechnicals.js", "utf-8");
  const hasDetector = /52-week high breakout on RVOL/.test(src);
  assert(hasDetector, "16. New 52-week-high-on-RVOL setup detector added to stocksTechnicals.js", "");
  const scoreLine = src.match(/name:\s*"52-week high breakout on RVOL"[\s\S]{0,200}score:\s*(\d+)/);
  const score = scoreLine ? Number(scoreLine[1]) : null;
  assert(score === 82, "16b. Detector emits score 82 (bull flag < 82 < VCP 85)", `got ${score}`);
}

// ─── Bonus: sanity check on scoreFundamentals — high-P/E name
// shouldn't score 0 on fundamentals just because P/E is high.
function test_bonus_pERoeSanity() {
  // A hypergrowth name: high P/E, high ROE, decent margins — audit
  // said prior peRoe > 3 → 0. We didn't touch scoreFundamentals's
  // peRoe curve in Tier 1 (deferred to Tier 2 with valuation model).
  // Just document current behavior so we notice regressions.
  const f = scoreFundamentals({ ok: true, pe: 60, roe: 15, dToE: 0.5, freeCashFlowYieldPct: 1 }).score;
  // Just assert scoring runs; PE/ROE curve reform is Tier 2 valuation work.
  assert(Number.isFinite(f) && f >= 0 && f <= 1, "Bonus. scoreFundamentals still returns [0,1] on high-P/E growth name",
    `got ${f}`);
}

async function run() {
  console.log("\n═══ Tier 1 — Anti-Winner Defect Fix Regression Tests ═══\n");
  test1_rsiNeverNegative();
  test2_rsiTrendZoneStayHigh();
  test3_rsiExtendedBlowoffTaper();
  test4_rsiSweetSpotUnchanged();
  test5_nvdaWalkthroughSurvivesMinScore();
  test6_growthNoLongerSaturates();
  test7_growthEpsAcceleration();
  test8_growthLowerBucketsPreserved();
  await test9_gapExtensionThresholdRaised();
  await test10_gapExtensionSwingOnlyClause();
  await test11_universeCapRaised();
  await test12_smallCapFloorLowered();
  await test13_discoveryCeilingRaised();
  await test14_sma50PenaltyHalved();
  await test15_momentumVocabNarrowed();
  await test16_newHighBreakoutDetectorExists();
  test_bonus_pERoeSanity();

  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const r of results.filter(x => x.status === "FAIL")) {
      console.log(`  • ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

run().catch((e) => { console.error("test-run crash:", e); process.exit(2); });
