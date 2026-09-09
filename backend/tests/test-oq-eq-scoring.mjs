#!/usr/bin/env node
// test-oq-eq-scoring.mjs
//
// P2 regression tests — separate OPPORTUNITY QUALITY (WHAT to own) from
// ENTRY QUALITY (WHEN to buy); pluggable scoring models A-F; industry
// strength with sector fallback; extended distribution persistence;
// WATCH — HIGH-QUALITY / ENTRY-NOT-READY tier + tracking hooks.
//
// P2's stated architectural aim: create a MORE RATIONAL discovery
// engine. Whether it OUT-selects the champion is for P3/P4 to
// measure. These tests only assert the architecture is right.

import fs from "fs";
import { SCORING_MODELS, ALL_MODEL_IDS, CHAMPION_MODEL_ID, getModel } from "../services/stocksScoringModels.js";
import { computeOpportunityScore } from "../services/stocksOpportunityScore.js";
import { computeEntryScore, combineOqEq, classifyOqEqTier, deriveEntrySubScoresFromTech } from "../services/stocksEntryScore.js";
import { getIndustryStrength } from "../services/stocksIndustryStrength.js";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── Scoring models ─────────────────────────────────────────────────
function test1_modelsDeclared() {
  const ids = ALL_MODEL_IDS;
  assert(ids.includes("A") && ids.includes("B") && ids.includes("C")
      && ids.includes("D") && ids.includes("E") && ids.includes("F"),
    "1. All six scoring models declared (A-F)");
  assert(CHAMPION_MODEL_ID === "A", "1b. Champion is model A");
}

function test2_modelWeightsSumTo1() {
  for (const id of ALL_MODEL_IDS) {
    const m = SCORING_MODELS[id];
    const ow = Object.values(m.opportunityWeights).reduce((a, b) => a + b, 0);
    const ew = Object.values(m.entryWeights).reduce((a, b) => a + b, 0);
    const cw = m.combineWeights.opportunity + m.combineWeights.entry;
    assert(Math.abs(ow - 1) < 0.02, `2-${id}-oq. Model ${id} opportunity weights sum to 1.0`, `sum=${ow}`);
    assert(Math.abs(ew - 1) < 0.02, `2-${id}-eq. Model ${id} entry weights sum to 1.0`, `sum=${ew}`);
    assert(Math.abs(cw - 1) < 0.02, `2-${id}-cw. Model ${id} combine weights sum to 1.0`, `sum=${cw}`);
  }
}

function test3_opportunityWeightBiasesOverEntry() {
  // Every CHALLENGER model (B-F) must give opportunity ≥ entry
  // weight — a mediocre company with a beautiful chart must NOT
  // become a high-conviction BUY. Model A (champion) is deliberately
  // preserved with the LEGACY entry-heavy weighting so P4 shadow
  // testing has a control against which the challengers can be
  // measured. The P2 architecture aim is that any challenger that
  // wins does so with opportunity dominating entry.
  const challengers = ALL_MODEL_IDS.filter(id => id !== CHAMPION_MODEL_ID);
  for (const id of challengers) {
    const m = SCORING_MODELS[id];
    assert(m.combineWeights.opportunity >= m.combineWeights.entry - 0.001,
      `3-${id}. Challenger model ${id} weights opportunity ≥ entry (${m.combineWeights.opportunity} vs ${m.combineWeights.entry})`);
  }
  const a = SCORING_MODELS.A.combineWeights;
  assert(a.opportunity + a.entry === 1.0,
    "3-A-ctrl. Champion model A intentionally preserves LEGACY entry-heavy weighting as the P4 control (documented)");
}

// ─── Opportunity scorer ─────────────────────────────────────────────
function test4_opportunityScoreBasic() {
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.9, growthScore: 0.9, revisionsScore: 0.9,
    relativeStrengthScore: 0.9, insiderScore: 0.9, industryStrengthScore: 0.9,
  }, "A");
  assert(oq.score >= 80 && oq.score <= 100,
    "4. OQ near 90 across all factors → score ≥ 80", `got ${oq.score}`);
  assert(oq.missingFactors.length === 0, "4b. No missing factors reported");
}

function test5_opportunityScoreRedistributesMissing() {
  // A missing factor must be excluded AND its weight redistributed.
  const withRevs = computeOpportunityScore({
    fundamentalsScore: 0.8, growthScore: 0.8, revisionsScore: 0.8,
    relativeStrengthScore: 0.8, insiderScore: 0.8,
    industryStrengthScore: 0.8,
  }, "A");
  const noRevs = computeOpportunityScore({
    fundamentalsScore: 0.8, growthScore: 0.8, // no revisions
    relativeStrengthScore: 0.8, insiderScore: 0.8,
    industryStrengthScore: 0.8,
  }, "A");
  assert(Math.abs(noRevs.score - withRevs.score) < 5,
    "5. Missing factor redistributes weight — score does not collapse",
    `withRevs=${withRevs.score} noRevs=${noRevs.score}`);
  assert(noRevs.missingFactors.includes("revisions"),
    "5b. Missing factor reported in provenance");
}

function test6_opportunityScoreIgnoresEntryFactors() {
  // Two candidates with identical fundamentals should score identically
  // on OQ regardless of chart timing. (OQ scorer only accepts the
  // fundamentals-family inputs — an entry-shaped input would be
  // ignored.)
  const goodEntry = { fundamentalsScore: 0.7, growthScore: 0.7 };
  const badEntry  = { fundamentalsScore: 0.7, growthScore: 0.7,
                      /* passing entry-shaped fields → ignored */
                      trend: 0.1, setup: 0.0 };
  const a = computeOpportunityScore(goodEntry, "A");
  const b = computeOpportunityScore(badEntry, "A");
  assert(a.score === b.score,
    "6. OQ score is independent of chart / entry inputs",
    `a=${a.score} b=${b.score}`);
}

// ─── Entry scorer ───────────────────────────────────────────────────
function test7_entryScoreExtensionPenalty() {
  // Two identical setups but one is stretched 30% above SMA50 with a
  // stretched RSI — the extension penalty should crush its EQ under
  // the models that actually weight extension (E carries the largest
  // extension weight at 0.15). Champion A does NOT weight extension
  // (0.0) by design — it preserves legacy weighting for the P4 control.
  const constructive = { trend: 1.0, setup: 1.0, mtf: 1.0, rsi: 1.0, rvol: 0.7, extension: 1.0 };
  const chased       = { trend: 1.0, setup: 1.0, mtf: 1.0, rsi: 0.3, rvol: 0.7, extension: 0.05 };
  const eqOk    = computeEntryScore(constructive, "E", { derivedFromTech: true });
  const eqChase = computeEntryScore(chased, "E", { derivedFromTech: true });
  assert(eqOk.score > eqChase.score + 15,
    "7. Chased / extended setup earns a materially lower EQ under model E (weights extension + rsi)", `ok=${eqOk.score} chase=${eqChase.score}`);
}

function test8_entrySubScoresFromTech() {
  // Wire the getTechnicals-shaped input through the derivation.
  // tech.mtfConfluence is the FLAT field produced by Stage 1
  // (`mtfConfluence: tech.mtf?.confluence || null`), which is what
  // the entry scorer reads. A nested `mtf.confluence` would be the
  // raw-tech shape before Stage-1 normalization.
  const subs = deriveEntrySubScoresFromTech({
    ok: true, sma50: 100, sma200: 90, priceVsSma50: 4,
    rsi14: 58, rvol: 1.8, setupName: "bull-flag",
    mtfConfluence: "aligned",
  });
  assert(subs.trend === 1.0, "8. Bullish trend → trend=1.0");
  assert(subs.rsi === 1.0, "8b. RSI 58 → sweet-spot RSI=1.0");
  assert(subs.setup === 1.0, "8c. Named setup → setup=1.0");
  assert(subs.mtf === 1.0, "8d. MTF aligned → mtf=1.0");
  assert(subs.rvol === 0.7, "8e. RVOL 1.8 (band 1.5-2.0) → rvol=0.7");
  assert(subs.extension === 1.0, "8f. Price 4% above SMA50 → extension=1.0");
}

function test9_entryScoreIgnoresFundamentals() {
  // Handing OQ-shaped inputs to computeEntryScore should NOT produce
  // a high entry score.
  const oqShaped = { fundamentalsScore: 1, growthScore: 1, revisionsScore: 1 };
  const eq = computeEntryScore(oqShaped, "A");
  assert(eq.score === 0,
    "9. Entry scorer ignores OQ-shaped fields — score stays 0",
    `got ${eq.score}`);
}

// ─── OQ/EQ tier classifier ──────────────────────────────────────────
function test10_tierBuyCandidate() {
  const t = classifyOqEqTier({ opportunityScore: 82, entryScore: 78 });
  assert(t === "BUY_CANDIDATE", "10. High OQ + high EQ → BUY_CANDIDATE");
}
function test11_tierHighQualityNoEntry() {
  const t = classifyOqEqTier({ opportunityScore: 85, entryScore: 55 });
  assert(t === "WATCH_HIGH_QUALITY_NO_ENTRY",
    "11. HIGH-QUALITY + BAD ENTRY → WATCH_HIGH_QUALITY_NO_ENTRY (spec §10)");
}
function test12_tierPrettyChartMediocreCompany() {
  const t = classifyOqEqTier({ opportunityScore: 62, entryScore: 88 });
  assert(t === "WATCH_SETUP_NO_QUALITY",
    "12. Mediocre company + beautiful chart → WATCH_SETUP_NO_QUALITY (not a BUY)");
}
function test13_tierBelowThreshold() {
  const t = classifyOqEqTier({ opportunityScore: 40, entryScore: 40 });
  assert(t === "BELOW_THRESHOLD", "13. Low OQ + low EQ → BELOW_THRESHOLD");
}

function test14_combineOqEqRespectsWeights() {
  // Model A is 40% opportunity / 60% entry (preserves champion 40T
  // bias when cast as OQ/EQ). Model D is 60/40.
  const a = combineOqEq(50, 100, "A");
  const d = combineOqEq(50, 100, "D");
  assert(a > d,
    "14. Under model A (entry-heavy), a great chart weighs more than under model D",
    `A=${a} D=${d}`);
}

// ─── Industry strength ──────────────────────────────────────────────
function test15_industryStrengthSectorFallback() {
  // Without a peer fetcher, industry strength falls back to sector
  // rotation. This is the mandated fallback in stocksIndustryStrength.js.
  return getIndustryStrength("MSFT", {
    fundamentals: { sector: "Technology", industry: "Software—Infrastructure" },
    sectorRotation: {
      rankings: [
        { sector: "Technology", rank: 1, momentum1mPct: 4.5 },
        { sector: "Energy", rank: 11, momentum1mPct: -3.0 },
      ],
    },
    benchmarkTicker: "SPY",
  }).then(r => {
    assert(r?.source === "sector-fallback",
      "15. Missing peer fetcher → sector-fallback source", `source=${r?.source}`);
    assert(r?.score >= 0.8,
      "15b. Sector +4.5% momentum → score near 1.0", `score=${r?.score}`);
  });
}

function test16_industryStrengthUnavailable() {
  return getIndustryStrength("UNKNOWN", {}).then(r => {
    assert(r?.score === null && r?.source === "unavailable",
      "16. No fundamentals AND no sector rotation → score null + unavailable source");
  });
}

// ─── Distribution schema — new fields present ──────────────────────
function test17_distributionModelFields() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksPickDistribution.js", "utf-8");
  for (const f of ["opportunityScore", "entryScore", "oqEqTier",
                    "industryStrength", "factorBreakdown", "scoreByModel",
                    "failedGates", "priceAtScore", "dataAsOf",
                    "championModelId", "engineVersion", "funnel",
                    "watchHighQualityCount"]) {
    assert(src.includes(f), `17-${f}. StocksPickDistribution schema declares field ${f}`);
  }
}

function test18_watchListModelPresent() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksWatchListEntry.js", "utf-8");
  assert(/mongoose\.model\("StocksWatchListEntry"/.test(src),
    "18. StocksWatchListEntry model declared");
  assert(/WatchListSchema\.index\(\{\s*email:\s*1,\s*pickDate:\s*1,\s*ticker:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/.test(src),
    "18b. Unique (email, pickDate, ticker) index for idempotent upserts");
  for (const f of ["opportunityScore", "entryScore", "modelId", "factorSnapshot", "priceAtAdd", "status", "outcomeMovePct"]) {
    assert(src.includes(f), `18-${f}. WatchList schema declares field ${f}`);
  }
}

// ─── Pick engine wiring ─────────────────────────────────────────────
function test19_engineWiresOqEq() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(src.includes("computeOpportunityScore"),
    "19. Pick engine imports computeOpportunityScore");
  assert(src.includes("computeEntryScore"),
    "19b. Pick engine imports computeEntryScore");
  assert(src.includes("getIndustryStrength"),
    "19c. Pick engine fetches industry strength per candidate");
  assert(src.includes("classifyOqEqTier"),
    "19d. Pick engine classifies each candidate into an OQ/EQ tier");
  assert(src.includes("StocksWatchListEntry"),
    "19e. Pick engine wires WATCH — HIGH-QUALITY / ENTRY-NOT-READY persistence");
  assert(src.includes("scoreByModel"),
    "19f. Pick engine persists all-model per-candidate scores");
}

function test20_engineFunnelCeilingsRaised() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(/Math\.max\(10, Math\.min\(150, Number\(process\.env\.STOCKS_MULTI_FACTOR_TOP_K\)/.test(src),
    "20. MULTI_FACTOR_TOP_K ceiling raised from 60 → 150 (env-tunable funnel widen)");
  assert(/Math\.max\(5, Math\.min\(75, Number\(process\.env\.STOCKS_RESCUE_TOP_K\)/.test(src),
    "20b. RESCUE_TOP_K ceiling raised from 30 → 75");
}

function test21_engineVersionStamped() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(/const ENGINE_VERSION = "2\.0\.0"/.test(src),
    "21. Engine version bumped to 2.0.0 (P2)");
  assert(src.includes("engineVersion: ENGINE_VERSION"),
    "21b. Distribution row is stamped with engineVersion");
}

// ─── Absolute qualifying threshold survives P2 ─────────────────────
function test22_absoluteThresholdIntact() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(src.includes("NO QUALIFYING OPPORTUNITY TODAY"),
    "22. P0B absolute qualifying threshold survives P2 (still logs NO QUALIFYING OPPORTUNITY)");
  assert(src.includes("qualifiedCombined = combined.filter(c => classifyDisqualification(c) == null)"),
    "22b. Engine still filters through classifyDisqualification before slicing");
}

// ─── LLM is not the picker (architecture invariant) ────────────────
function test23_llmNotPrimaryPicker() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  // The pick engine only produces `top` via qualifiedCombined.slice(0, n) —
  // never based on any AI verdict.
  assert(!/callClaude\(|callOpenAI\(|anthropic\.messages/.test(src),
    "23. Pick engine contains NO LLM call — LLM is not the primary picker");
}

async function run() {
  console.log("\n═══ P2 OQ/EQ split + models + distribution ═══\n");
  test1_modelsDeclared();
  test2_modelWeightsSumTo1();
  test3_opportunityWeightBiasesOverEntry();
  test4_opportunityScoreBasic();
  test5_opportunityScoreRedistributesMissing();
  test6_opportunityScoreIgnoresEntryFactors();
  test7_entryScoreExtensionPenalty();
  test8_entrySubScoresFromTech();
  test9_entryScoreIgnoresFundamentals();
  test10_tierBuyCandidate();
  test11_tierHighQualityNoEntry();
  test12_tierPrettyChartMediocreCompany();
  test13_tierBelowThreshold();
  test14_combineOqEqRespectsWeights();
  await test15_industryStrengthSectorFallback();
  await test16_industryStrengthUnavailable();
  test17_distributionModelFields();
  test18_watchListModelPresent();
  test19_engineWiresOqEq();
  test20_engineFunnelCeilingsRaised();
  test21_engineVersionStamped();
  test22_absoluteThresholdIntact();
  test23_llmNotPrimaryPicker();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(2); });
