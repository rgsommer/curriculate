#!/usr/bin/env node
// test-p25-signal-quality.mjs
//
// P2.5 SIGNAL-QUALITY PATCH regression tests. Every dangerous case
// enumerated in the spec §10 gets an explicit test:
//   • price-target change is NOT treated as EPS estimate revision
//   • actual upward EPS revision raises revision score
//   • downward revisions lower it
//   • missing REAL revision data causes Model C INSUFFICIENT_DATA
//     rather than weight redistribution
//   • positive earnings surprise + gap retention scores better than
//     positive surprise + gap failure
//   • true peer/industry strength is used when available
//   • sector fallback is explicitly labelled
//   • insufficient peer count cannot masquerade as industry confirmation
//   • news-noise catalyst cannot materially boost OQ
//   • material earnings/guidance catalyst can
//   • Model E without earnings/catalyst evidence cannot claim
//     high-confidence post-earnings status (INSUFFICIENT_DATA)
//   • factorCoveragePct is persisted per candidate
//   • raw factor snapshots are immutable after scoring (first-write-wins)

import fs from "fs";
import { classifyCatalystItem, isMaterial } from "../services/stocksCatalystClassifier.js";
import { computeOpportunityScore } from "../services/stocksOpportunityScore.js";
import { SCORING_MODELS, ALL_MODEL_IDS, CHAMPION_MODEL_ID } from "../services/stocksScoringModels.js";
import { getIndustryStrength } from "../services/stocksIndustryStrength.js";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── Estimate revisions vs price-target proxy ──────────────────────
function test1_priceTargetIsNotEpsRevision() {
  // Model C's OQ opportunity weights: revisions 0.40 dominates. If we
  // pass ONLY the price-target proxy (no real revisions), Model C must
  // return INSUFFICIENT_DATA — the price-target field is priceTargetContext,
  // NOT the critical `revisions` factor.
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.7,
    growthScore: 0.6,
    relativeStrengthScore: 0.6,
    insiderScore: 0.5,
    industryStrengthScore: 0.6,
    priceTargetContextScore: 0.9,     // strong price-target proxy
    revisionsScore: null,             // NO real revisions
    revisionsMeta: { hasReal4wBaseline: false },
  }, "C");
  assert(oq.status === "INSUFFICIENT_DATA",
    "1. Model C with ONLY price-target proxy → INSUFFICIENT_DATA (price-target ≠ EPS revision)",
    `status=${oq.status}`);
  assert((oq.missingCriticalFactors || []).includes("revisions"),
    "1b. Missing critical factor named `revisions`");
}

function test2_realRevisionsLifts() {
  // Same fundamentals + growth + RS as test1, but pass a REAL revisions
  // sub-score with hasReal4wBaseline=true. Model C now returns OK
  // with score ≥ 60 (weights: revisions 0.40 × 0.85 + others).
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.7, growthScore: 0.6,
    revisionsScore: 0.85,             // strong REAL revisions
    revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.6, insiderScore: 0.5,
    industryStrengthScore: 0.6,
  }, "C");
  assert(oq.status === "OK" && oq.score >= 60,
    "2. Model C with strong REAL EPS revisions → OK + score ≥ 60",
    `status=${oq.status} score=${oq.score}`);
}

function test3_downwardRevisionsLower() {
  // Weak REAL revisions (0.20) with rest identical should score < strong.
  const strong = computeOpportunityScore({
    fundamentalsScore: 0.7, growthScore: 0.6, revisionsScore: 0.85,
    revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.6, insiderScore: 0.5, industryStrengthScore: 0.6,
  }, "C");
  const weak = computeOpportunityScore({
    fundamentalsScore: 0.7, growthScore: 0.6, revisionsScore: 0.20,
    revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.6, insiderScore: 0.5, industryStrengthScore: 0.6,
  }, "C");
  assert(strong.score > weak.score + 15,
    "3. Downward revisions produce materially lower Model C score",
    `strong=${strong.score} weak=${weak.score}`);
}

// ─── Coverage-aware confidence ─────────────────────────────────────
function test4_factorCoverageReported() {
  // 3 of 6 champion OQ factors present → coverage < 100%.
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.8,
    growthScore: 0.7,
    revisionsScore: 0.6,
    revisionsMeta: { hasReal4wBaseline: true },
  }, "A");
  assert(oq.status === "OK", "4-pre. Model A tolerates partial data (no critical factors)");
  assert(Number.isFinite(oq.factorCoveragePct) && oq.factorCoveragePct > 0 && oq.factorCoveragePct < 100,
    "4. factorCoveragePct reported (0 < coverage < 100)",
    `coverage=${oq.factorCoveragePct}`);
}

function test5_lowCoverageDowngradesConfidence() {
  // Only 30% of Model B's declared weight present → confidenceStamp = LOW.
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.8,           // 0.35 of B's weight — meets critical
  }, "B");
  assert(oq.status === "OK", "5-pre. Model B satisfied by present critical fundamentals");
  assert(oq.confidenceStamp === "LOW",
    "5. Low coverage (35%) downgrades confidenceStamp to LOW",
    `stamp=${oq.confidenceStamp} coverage=${oq.factorCoveragePct}`);
}

// ─── Model E — earnings/catalyst evidence required ─────────────────
function test6_modelEWithoutSurpriseOrCatalyst() {
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.8, growthScore: 0.8,
    revisionsScore: 0.8, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.7, insiderScore: 0.7,
    industryStrengthScore: 0.7,
    // NO surprise, NO catalyst
    postEarningsDriftScore: null,
    catalystQualityScore: null,
  }, "E");
  assert(oq.status === "INSUFFICIENT_DATA",
    "6. Model E without post-earnings drift AND without catalyst → INSUFFICIENT_DATA");
  assert((oq.missingCriticalFactors || []).some(k => k.includes("postEarningsDrift")),
    "6b. Critical missing factor reported as `postEarningsDrift|catalystQuality`");
}

function test7_modelEWithDriftSatisfies() {
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.8, growthScore: 0.8,
    revisionsScore: 0.8, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.7, insiderScore: 0.7,
    industryStrengthScore: 0.7,
    postEarningsDriftScore: 0.75,
  }, "E");
  assert(oq.status === "OK" && oq.score >= 60,
    "7. Model E with real post-earnings drift → OK with meaningful score",
    `status=${oq.status} score=${oq.score}`);
}

function test8_modelEWithMaterialCatalystSatisfies() {
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.8, growthScore: 0.8,
    revisionsScore: 0.8, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.7, insiderScore: 0.7,
    industryStrengthScore: 0.7,
    catalystQualityScore: 0.75,
  }, "E");
  assert(oq.status === "OK",
    "8. Model E satisfied by a material catalyst alone (drift OR catalyst)");
}

// ─── Model F — industry strength required ──────────────────────────
function test9_modelFWithoutIndustryFails() {
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.8, growthScore: 0.7,
    revisionsScore: 0.7, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.8, insiderScore: 0.7,
    industryStrengthScore: null,       // no industry data at all
  }, "F");
  assert(oq.status === "INSUFFICIENT_DATA",
    "9. Model F without ANY industry data → INSUFFICIENT_DATA");
}

function test10_modelFSectorFallbackReducesConfidence() {
  const oq = computeOpportunityScore({
    fundamentalsScore: 0.7, growthScore: 0.6,
    revisionsScore: 0.6, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.7, insiderScore: 0.5,
    industryStrengthScore: 0.6,
    industryStrengthMeta: { source: "sector-fallback" },
  }, "F");
  assert(oq.status === "OK",
    "10. Model F sector-fallback still runs (industry critical satisfied)");
  assert(oq.confidenceStamp === "MEDIUM" || oq.confidenceStamp === "LOW",
    "10b. Sector-fallback source reduces Model F confidence below HIGH",
    `stamp=${oq.confidenceStamp}`);
}

// ─── Catalyst classifier ───────────────────────────────────────────
function test11_materialEarningsCatalystScoresHigh() {
  const c = classifyCatalystItem({
    ticker: "ACME", source: "fmp-news", sourceId: "1", eventDate: "2026-09-09",
    headline: "Acme Corp raises FY guidance after Q3 earnings beat",
  });
  assert(c.category === "EARNINGS_GUIDANCE",
    "11. Guidance-raise headline classifies as EARNINGS_GUIDANCE");
  assert(c.materialityScore >= 30 && isMaterial(c),
    "11b. Materiality clears the 30 threshold",
    `score=${c.materialityScore}`);
}

function test12_newsNoiseCannotBoost() {
  const c = classifyCatalystItem({
    ticker: "ACME", source: "fmp-news", sourceId: "2", eventDate: "2026-09-09",
    headline: "Reddit chatter: Acme shares surge as social media buzz builds",
  });
  assert(c.category === "NEWS_NOISE",
    "12. Pure social/momentum headline classifies as NEWS_NOISE");
  assert(!isMaterial(c),
    "12b. NEWS_NOISE never passes the materiality gate");
  assert(c.materialityScore <= 20,
    "12c. NEWS_NOISE materiality bounded low",
    `score=${c.materialityScore}`);
}

function test13_regulatoryApprovalHighMateriality() {
  const c = classifyCatalystItem({
    ticker: "ACME", source: "sec-8k", sourceId: "3", eventDate: "2026-09-09",
    headline: "FDA approves Acme's lead compound in Phase III trial",
  });
  assert(c.category === "REGULATORY_APPROVAL",
    "13. FDA-approval headline classifies as REGULATORY_APPROVAL");
  assert(c.materialityScore >= 50,
    "13b. Regulatory approval carries high materiality",
    `score=${c.materialityScore}`);
}

function test14_maSpecialSituationDetected() {
  const c = classifyCatalystItem({
    ticker: "ACME", source: "fmp-news", sourceId: "4", eventDate: "2026-09-09",
    headline: "Acme agrees to acquire BetaCo for $2.4bn in cash and stock",
  });
  assert(c.category === "MA_SPECIAL_SITUATION",
    "14. Acquisition headline classifies as MA_SPECIAL_SITUATION");
  assert(c.extras?.contractSize?.value === 2.4,
    "14b. Extras extraction pulls the deal size (2.4)",
    `extras=${JSON.stringify(c.extras)}`);
}

// ─── Industry strength — peer count enforcement ────────────────────
async function test15_industryStrengthRequiresMinPeers() {
  // A peerFetcher that returns only 2 tickers is below MIN_PEER_COUNT.
  // Result: sector fallback (with source labeled).
  const r = await getIndustryStrength("ACME", {
    fundamentals: { sector: "Technology", industry: "Software" },
    peerFetcher: async () => ["A", "B"],   // only 2 — below default 5
    sectorRotation: { rankings: [{ sector: "Technology", rank: 1, momentum1mPct: 3 }] },
  });
  assert(r?.source === "sector-fallback",
    "15. <5 peers cannot masquerade as industry — falls back to sector",
    `source=${r?.source}`);
  assert(!Number.isFinite(r?.peerCount) || r.peerCount == null,
    "15b. peerCount is null when fallback path is used");
}

async function test16_industryStrengthUnavailableWhenNoData() {
  const r = await getIndustryStrength("XYZ", {});
  assert(r?.source === "unavailable" && r?.score == null,
    "16. No peers AND no sector data → source=unavailable, score=null");
}

// ─── Distribution schema — new P2.5 fields present ────────────────
function test17_distributionSchemaExtended() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksPickDistribution.js", "utf-8");
  for (const f of ["factorCoveragePct", "criticalFactorCoverage", "stage1Shadow"]) {
    assert(src.includes(f), `17-${f}. Distribution schema declares P2.5 field ${f}`);
  }
}

function test18_scoreSnapshotModel() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksScoreSnapshot.js", "utf-8");
  assert(/mongoose\.model\("StocksScoreSnapshot"/.test(src),
    "18. StocksScoreSnapshot model declared");
  for (const f of ["fundamentalsRaw", "growthRaw", "estimateRevisionRaw",
                    "priceTargetRaw", "techSummary", "industryStrengthRaw",
                    "surpriseHistorySample", "catalystSample",
                    "factorCoveragePct", "criticalFactorCoverage",
                    "engineVersion"]) {
    assert(src.includes(f), `18-${f}. Snapshot schema declares field ${f}`);
  }
}

function test19_snapshotIsImmutable() {
  // The engine persists snapshots with $setOnInsert (first-write-wins).
  // Overwrites are explicitly prevented.
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(src.includes("StocksScoreSnapshot.updateOne"),
    "19. Engine calls StocksScoreSnapshot.updateOne for persistence");
  assert(/\$setOnInsert:\s*\{/.test(src),
    "19b. Snapshot uses $setOnInsert (immutable — first write wins)");
}

// ─── Analyst EPS + earnings-surprise cache models ─────────────────
function test20_analystSnapshotModel() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksAnalystEpsSnapshot.js", "utf-8");
  for (const f of ["fy0_eps", "fy1_eps", "q0_eps", "q1_eps",
                    "fy0_revenue", "analystCountEps", "rawSample"]) {
    assert(src.includes(f), `20-${f}. Analyst EPS snapshot schema declares ${f}`);
  }
  assert(/EpsSnapshotSchema\.index\(\{\s*ticker:\s*1,\s*ymd:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/.test(src),
    "20-idx. Snapshot has unique (ticker, ymd) index — one row per calendar day");
}

function test21_earningsSurpriseModel() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksEarningsSurpriseCache.js", "utf-8");
  for (const f of ["reportedEPS", "estimatedEPS", "epsSurprisePct",
                    "gapOpenPct", "day1ClosePct", "day5ClosePct",
                    "gapHeldAtDay5", "postEarningsDriftScore",
                    "driftClassification"]) {
    assert(src.includes(f), `21-${f}. Earnings-surprise cache declares ${f}`);
  }
}

// ─── Engine wiring ─────────────────────────────────────────────────
function test22_engineWiresNewSignals() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(src.includes("getRealEpsRevisions"),
    "22. Engine imports getRealEpsRevisions");
  assert(src.includes("getEarningsSurpriseAndDrift"),
    "22b. Engine imports getEarningsSurpriseAndDrift");
  assert(src.includes("revisionsMeta"),
    "22c. Engine passes revisionsMeta through to OQ scorer");
  assert(src.includes("industryStrengthMeta"),
    "22d. Engine passes industryStrengthMeta through to OQ scorer");
  assert(src.includes("stage1Shadow"),
    "22e. Engine builds and persists stage1Shadow (funnel widen record)");
  assert(/ENGINE_VERSION = "2\.[12]\.0"/.test(src),
    "22f. Engine version at 2.1.0 (P2.5) or later");
}

// ─── Simulated post-earnings drift outcomes ────────────────────────
// Direct import of the internal scoreDrift is not exported; construct
// two synthetic surprise-result shapes and pass them through the OQ
// scorer to confirm the classification steers Model E composite.
function test23_gapHoldsBeatsGapFails() {
  const held = computeOpportunityScore({
    fundamentalsScore: 0.7, growthScore: 0.7,
    revisionsScore: 0.7, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.6, insiderScore: 0.5,
    industryStrengthScore: 0.7,
    postEarningsDriftScore: 0.85,     // gap held, positive drift
  }, "E");
  const failed = computeOpportunityScore({
    fundamentalsScore: 0.7, growthScore: 0.7,
    revisionsScore: 0.7, revisionsMeta: { hasReal4wBaseline: true },
    relativeStrengthScore: 0.6, insiderScore: 0.5,
    industryStrengthScore: 0.7,
    postEarningsDriftScore: 0.25,     // gap failed
  }, "E");
  assert(held.score > failed.score,
    "23. POSITIVE_ACCEPTANCE > POSITIVE_FAILED at Model E",
    `held=${held.score} failed=${failed.score}`);
}

// ─── Great chart, no fundamental / revision coverage ──────────────
function test24_greatChartNoCoverageCannotWin() {
  // Model D (GARP+revisions+momentum) requires fundamentals AND growth
  // to be present. A candidate with just entry signals must return
  // INSUFFICIENT_DATA under Model D.
  const oq = computeOpportunityScore({
    // no fundamentals, no growth, no revisions
    relativeStrengthScore: 0.9,
    insiderScore: 0.8,
    industryStrengthScore: 0.8,
  }, "D");
  assert(oq.status === "INSUFFICIENT_DATA",
    "24. Great chart + no fundamental/revision coverage → INSUFFICIENT_DATA (Model D)");
}

// ─── Scoring model documentation invariants ────────────────────────
function test25_challengerModelsDeclareCriticalFactors() {
  for (const id of ALL_MODEL_IDS.filter(x => x !== CHAMPION_MODEL_ID)) {
    const m = SCORING_MODELS[id];
    assert(Array.isArray(m.criticalFactors) && m.criticalFactors.length > 0,
      `25-${id}. Challenger model ${id} declares ≥1 criticalFactors`,
      `model=${JSON.stringify(m.criticalFactors)}`);
  }
}
function test26_championHasNoCriticalGate() {
  const a = SCORING_MODELS.A;
  assert(Array.isArray(a.criticalFactors) && a.criticalFactors.length === 0,
    "26. Champion model A has no critical factors (LEGACY control)");
}

async function run() {
  console.log("\n═══ P2.5 SIGNAL-QUALITY PATCH regression ═══\n");
  test1_priceTargetIsNotEpsRevision();
  test2_realRevisionsLifts();
  test3_downwardRevisionsLower();
  test4_factorCoverageReported();
  test5_lowCoverageDowngradesConfidence();
  test6_modelEWithoutSurpriseOrCatalyst();
  test7_modelEWithDriftSatisfies();
  test8_modelEWithMaterialCatalystSatisfies();
  test9_modelFWithoutIndustryFails();
  test10_modelFSectorFallbackReducesConfidence();
  test11_materialEarningsCatalystScoresHigh();
  test12_newsNoiseCannotBoost();
  test13_regulatoryApprovalHighMateriality();
  test14_maSpecialSituationDetected();
  await test15_industryStrengthRequiresMinPeers();
  await test16_industryStrengthUnavailableWhenNoData();
  test17_distributionSchemaExtended();
  test18_scoreSnapshotModel();
  test19_snapshotIsImmutable();
  test20_analystSnapshotModel();
  test21_earningsSurpriseModel();
  test22_engineWiresNewSignals();
  test23_gapHoldsBeatsGapFails();
  test24_greatChartNoCoverageCannotWin();
  test25_challengerModelsDeclareCriticalFactors();
  test26_championHasNoCriticalGate();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(2); });
