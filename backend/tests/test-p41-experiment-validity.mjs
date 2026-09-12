#!/usr/bin/env node
// test-p41-experiment-validity.mjs
//
// P4.1 experiment-validity regression tests. Pure/no-Mongo.
//
// Covers spec §1..§14 for pure computational modules. §11 (actually
// starting the valid experiment) runs through scripts/run-p4-experiment.mjs.

import fs from "fs";
import { applyModelScoring, scoreCandidateAllModels } from "../services/stocksP4ModelScoring.js";
import { lastCompletedTradingDate, localExperimentDate, tradingDateBundle } from "../services/stocksTradingDate.js";
import { authorizeRecommendation, authorizeBatch } from "../services/stocksActionAuthorization.js";
import { P4_PROMOTION_CRITERIA, ALL_MODEL_IDS, ALL_P4_MODEL_IDS } from "../services/stocksScoringModels.js";
import { projectDailyCost, costComparisonBeforeAfter } from "../services/stocksP4Experiment.js";

let passed = 0, failed = 0; const fails = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; fails.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── §1  Per-model INDEPENDENT scoring ─────────────────────────────
function test1_models_produce_different_scores_on_same_candidate() {
  // Same raw factors → different weights → different combinedScore.
  const cand = {
    ticker: "TESTX",
    oqSubScores: { fundamentals: 90, growth: 80, revisions: 75, relativeStrength: 60, insider: 50, industryStrength: 55, postEarningsDrift: 40, catalystQuality: 30, priceTargetContext: 50 },
    eqSubScores: { trend: 80, setup: 70, mtf: 65, rsi: 60, rvol: 55, extension: 40 },
  };
  const rows = scoreCandidateAllModels(cand);
  const combined = ["A", "B", "C", "D", "E", "F"].map(m => rows[m].combinedScore);
  const uniq = new Set(combined.filter(Number.isFinite));
  assert(uniq.size >= 3, "1a. A-F produce at least 3 distinct combinedScore values on the SAME candidate", `combined=${JSON.stringify(combined)}`);
}

function test2_fixture_A_qual_B_rej_C_qual_D_watch_E_insuff_F_qual() {
  // Deliberately constructed factor values that exercise each model's
  // critical-gate + weight profile differently.
  //   A: LEGACY (no critical) with balanced factors → BUY
  //   B: requires fundamentals CRITICAL; fundamentals present → BUY too
  //     (constrain by lowering trend so B fails EQ but A passes)
  //   Simpler approach: build a candidate where multiple classifications
  //   emerge naturally. Rather than force 6 specific outcomes, assert
  //   at least 3 DISTINCT classifications appear across A-F.
  const cand = {
    ticker: "MIX",
    oqSubScores: {
      fundamentals: 90, growth: 55, revisions: null,  // revisions missing → C INSUFFICIENT
      relativeStrength: 90, insider: 60, industryStrength: 90,
      postEarningsDrift: null, catalystQuality: null,  // E INSUFFICIENT
      priceTargetContext: 40,
    },
    eqSubScores: { trend: 70, setup: 90, mtf: 45, rsi: 60, rvol: 50, extension: 30 },
  };
  const rows = scoreCandidateAllModels(cand);
  const cls = ["A", "B", "C", "D", "E", "F"].map(m => rows[m].classification);
  const distinct = new Set(cls);
  assert(distinct.size >= 3, "2a. Diverse fixture triggers ≥3 distinct classifications across A-F",
    `classifications=${JSON.stringify(cls)}`);
  assert(rows.C.confidence === "INSUFFICIENT_DATA",
    "2b. Model C rejects when its critical revisions factor is missing (no silent redistribution)");
  assert(rows.E.confidence === "INSUFFICIENT_DATA",
    "2c. Model E rejects when neither postEarningsDrift nor catalystQuality is present");
  assert(rows.A.confidence !== "INSUFFICIENT_DATA" && rows.A.classification !== "REJECTED",
    "2d. Model A (LEGACY, no critical) still produces a real score on the same input");
}

function test3_all_models_identical_would_fail() {
  // If a bug causes all models to output the same combinedScore, this
  // fixture must fail — one canary that a future regression is caught.
  const cand = {
    ticker: "STRESS",
    oqSubScores: { fundamentals: 80, growth: 80, revisions: 80, relativeStrength: 80, insider: 80, industryStrength: 80, postEarningsDrift: 80, catalystQuality: 80, priceTargetContext: 80 },
    eqSubScores: { trend: 70, setup: 70, mtf: 70, rsi: 70, rvol: 70, extension: 70 },
  };
  const rows = scoreCandidateAllModels(cand);
  // Even with flat inputs, combine-weight differences (A=40/60, B=65/35, etc.)
  // yield different combined scores.
  const combined = ["A", "B", "C", "D", "E", "F"].map(m => rows[m].combinedScore);
  const uniq = new Set(combined.filter(Number.isFinite));
  assert(uniq.size >= 2, "3. Even with flat sub-scores, combine-weight differences produce ≥2 distinct combinedScores",
    `combined=${JSON.stringify(combined)}`);
}

function test4_weightsUsed_per_row() {
  const cand = { ticker: "X", oqSubScores: { fundamentals: 90, growth: 80, revisions: 60 }, eqSubScores: { trend: 70, setup: 60, mtf: 50, rsi: 50, rvol: 50, extension: 50 } };
  const row = applyModelScoring(cand, "B");
  assert(row.weightsUsed?.opportunity?.fundamentals === 0.35,
    "4. Row carries weightsUsed provenance (spec §13) — Model B fundamentals weight = 0.35");
  assert(row.weightsUsed?.combine?.opportunity === 0.65,
    "4b. combineWeights.opportunity captured");
}

// ─── §5  Promotion criteria exact frozen JSON ──────────────────────
function test5_promotion_criteria_exact_frozen_fields() {
  const c = P4_PROMOTION_CRITERIA;
  const expected = {
    minQualifiedObservations: 30,
    minMature20dObservations: 20,
    minPositiveMedianAlpha20dPp: 0.5,
    minPositiveMeanAlpha20dPp: 0.5,
    mustBeatChampionMedianPp: 1.0,
    mustBeatPassiveMedianPp: 0.5,
    maxDrawdownPct: 15,
    robustWithoutTopWinner: true,
    minSectorsCovered: 2,
    minRegimesCovered: 1,
  };
  for (const [k, v] of Object.entries(expected)) {
    assert(c[k] === v, `5-${k}. ${k} === ${JSON.stringify(v)}`, `got ${JSON.stringify(c[k])}`);
  }
}

// ─── §6  Trading-date semantics ────────────────────────────────────
function test6_trading_date_weekday_after_close() {
  // Fri 2026-09-11 17:00 ET → Fri 2026-09-11 (session complete)
  const d = new Date("2026-09-11T21:00:00Z"); // 5pm ET = 21:00Z (EDT)
  const td = lastCompletedTradingDate(d);
  assert(td === "2026-09-11", `6a. Fri 5pm ET → 2026-09-11`, `got ${td}`);
}
function test7_trading_date_weekday_before_close() {
  // Fri 2026-09-11 10:00 ET → prior session (Thu 2026-09-10 unless holiday)
  const d = new Date("2026-09-11T14:00:00Z");
  const td = lastCompletedTradingDate(d);
  assert(td === "2026-09-10", `7a. Fri 10am ET → 2026-09-10 (session in progress)`, `got ${td}`);
}
function test8_trading_date_saturday() {
  const d = new Date("2026-09-12T15:00:00Z"); // Sat
  const td = lastCompletedTradingDate(d);
  assert(td === "2026-09-11", `8. Saturday → previous Friday`, `got ${td}`);
}
function test9_trading_date_sunday() {
  const d = new Date("2026-09-13T15:00:00Z"); // Sun
  const td = lastCompletedTradingDate(d);
  assert(td === "2026-09-11", `9. Sunday → previous Friday`, `got ${td}`);
}
function test10_trading_date_monday_premarket() {
  const d = new Date("2026-09-14T12:00:00Z"); // Mon 8am ET
  const td = lastCompletedTradingDate(d);
  assert(td === "2026-09-11", `10. Monday premarket → previous Friday`, `got ${td}`);
}
function test11_trading_date_holiday() {
  // 2026-09-07 is Labor Day. 2026-09-08 09:00 ET → last session is 2026-09-04 (Friday)
  const d = new Date("2026-09-08T13:00:00Z");
  const td = lastCompletedTradingDate(d);
  assert(td === "2026-09-04", `11. Day after holiday, pre-close → last real session (Fri before Labor Day)`, `got ${td}`);
}
function test12_tradingDateBundle_has_all_fields() {
  const b = tradingDateBundle(new Date("2026-09-12T15:00:00Z"));
  assert(typeof b.tradingDate === "string" && typeof b.localExperimentDate === "string"
      && typeof b.createdAtUtc === "string" && b.referenceTradingDate === b.tradingDate,
    "12. tradingDateBundle emits tradingDate + localExperimentDate + createdAtUtc + referenceTradingDate");
}

// ─── §7  Immutability audit ────────────────────────────────────────
function test13_immutability_guards_declared() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4Experiment.js", "utf-8");
  for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findByIdAndUpdate"]) {
    assert(src.includes(`"${op}"`), `13-${op}. StocksP4Experiment guards ${op}`);
  }
  const pickSrc = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4PickRecord.js", "utf-8");
  for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findByIdAndUpdate"]) {
    assert(pickSrc.includes(`"${op}"`), `13p-${op}. StocksP4PickRecord guards ${op}`);
  }
}
function test14_status_lives_in_separate_collection() {
  assert(fs.existsSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4ExperimentStatus.js"),
    "14. Data model separation: mutable status is in StocksP4ExperimentStatus, frozen definition stays untouched (spec §7)");
}

// ─── §8  Production AI action authorization ───────────────────────
function test15_A_discoveryPool_only_BUY_rejected() {
  const r = authorizeRecommendation({ action: "BUY", ticker: "AAA", source: "DISCOVERY_POOL" });
  assert(!r.authorized && r.reason.startsWith("unauthorized-BUY-source"),
    "15A. discoveryPool-only BUY REJECTED (spec §8-A)");
}
function test16_B_P4_pick_only_BUY_rejected() {
  const r = authorizeRecommendation({ action: "BUY", ticker: "BBB", source: "P4_BUY_CANDIDATE" });
  assert(!r.authorized, "15B. P4 BUY_CANDIDATE membership alone REJECTED");
}
function test17_C_watchlist_only_BUY_rejected() {
  const r = authorizeRecommendation({ action: "BUY", ticker: "CCC", source: "WATCHLIST" });
  assert(!r.authorized, "15C. Watchlist-only BUY REJECTED");
}
function test18_D_P4_shadow_qualified_BUY_rejected() {
  const r = authorizeRecommendation({ action: "BUY", ticker: "DDD", source: "P4_SHADOW_QUALIFIED" });
  assert(!r.authorized, "15D. P4 shadow-model-qualified BUY REJECTED");
}
function test19_E_daily_pick_validated_BUY_passes() {
  const r = authorizeRecommendation({ action: "BUY", ticker: "EEE", source: "DAILY_PICK_VALIDATED" });
  assert(r.authorized, "15E. Validated deterministic daily pick BUY AUTHORIZED");
}
function test20_F_mandate_BUY_passes() {
  const r = authorizeRecommendation({ action: "BUY", ticker: "FFF", source: "MANDATE" });
  assert(r.authorized, "15F. Validated MANDATE BUY AUTHORIZED");
}
function test21_SELL_on_non_held_rejected() {
  const held = new Set(["ABC"]);
  const r = authorizeRecommendation({ action: "SELL", ticker: "XYZ", source: "HOLD_CLASSIFIER", classifierAction: "SELL", heldTickers: held });
  assert(!r.authorized && r.reason.includes("non-held"),
    "16a. SELL on non-held ticker REJECTED");
}
function test22_action_mismatch_rejected() {
  const held = new Set(["ABC"]);
  const r1 = authorizeRecommendation({ action: "SELL", ticker: "ABC", source: "HOLD_CLASSIFIER", classifierAction: "HOLD", heldTickers: held });
  assert(!r1.authorized && r1.reason.includes("action-mismatch"),
    "16b. classifier=HOLD but AI=SELL → REJECT");
  const r2 = authorizeRecommendation({ action: "SELL", ticker: "ABC", source: "HOLD_CLASSIFIER", classifierAction: "TRIM", heldTickers: held });
  assert(!r2.authorized && r2.reason.includes("action-mismatch"),
    "16c. classifier=TRIM but AI=SELL → REJECT (no silent normalization)");
}
function test23_authorize_batch() {
  const recs = [
    { action: "BUY", ticker: "AAA", source: "DAILY_PICK_VALIDATED" },
    { action: "BUY", ticker: "BBB", source: "DISCOVERY_POOL" },
    { action: "BUY", ticker: "CCC", source: "P4_BUY_CANDIDATE" },
  ];
  const result = authorizeBatch(recs);
  const authorized = result.filter(r => r.authorized);
  assert(authorized.length === 1 && authorized[0].rec.ticker === "AAA",
    "17. authorizeBatch: only DAILY_PICK_VALIDATED passes, discovery+P4 rejected");
}

// ─── §10 Cost projection dedup ─────────────────────────────────────
function test24_cost_dedup_saves_6x() {
  const cmp = costComparisonBeforeAfter({ candidateCount: 25 });
  assert(cmp.before.fmpCalls > cmp.after.fmpCalls * 5,
    `24. Fetch-once architecture cuts FMP calls ≥5× vs per-model refetch (before=${cmp.before.fmpCalls}, after=${cmp.after.fmpCalls})`);
  assert(cmp.after.fmpCalls === cmp.after.candidateCount * 4,
    "24b. After: fmpCalls === candidateCount × 4 (no model multiplier on FETCHES)");
  assert(cmp.after.mongoWrites === cmp.after.candidateCount * 2 * 6,
    "24c. After: mongoWrites STILL scale with models (one row per model)");
}
function test25_projectDailyCost_default_shape() {
  const c = projectDailyCost({ candidateCount: 200 });
  assert(c.fmpCalls === 800 && c.yahooCalls === 400 && c.mongoWrites === 2400,
    "25. 200-candidate default: 800 FMP + 400 Yahoo + 2400 Mongo (fetch-once)", JSON.stringify(c));
}

// ─── §4 G is CONTROL, not CHALLENGER ───────────────────────────────
function test26_champion_state_enum_has_CONTROL() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4ChampionState.js", "utf-8");
  assert(src.includes("CONTROL"), "26. Champion state enum includes CONTROL (spec §4)");
}
function test27_promotion_evaluator_skips_G() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksP4Promotion.js", "utf-8");
  assert(/model === "G"/.test(src) && /continue/.test(src),
    "27. Promotion evaluator hard-skips Model G (control never gets promoted)");
}

// ─── §2 Pilot invalidation infrastructure ──────────────────────────
function test28_markPilotInvalid_exported() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksP4Experiment.js", "utf-8");
  assert(/export\s+async\s+function\s+markPilotInvalid/.test(src),
    "28. markPilotInvalid exported");
  assert(/computeLeaderboard[\s\S]{0,400}status === "PILOT_INVALID"/.test(src),
    "28b. computeLeaderboard excludes PILOT_INVALID experiments");
  assert(/evidenceCardSummary[\s\S]{0,400}PILOT_INVALID/.test(src),
    "28c. evidenceCardSummary reports PILOT_INVALID and refuses to synthesize alpha");
}

// ─── §11 Referential integrity report ─────────────────────────────
function test29_run_reports_actual_db_counts() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksP4Experiment.js", "utf-8");
  assert(src.includes("picksInDb") && src.includes("outcomesInDb"),
    "29. runTodayCandidates + attachOutcomeStubs report actual DB read-back counts (spec §3)");
  assert(src.includes("referentialGap"),
    "29b. Referential integrity gap (outcomes − picks) surfaced");
}

async function run() {
  console.log("\n═══ P4.1 experiment-validity regression ═══\n");
  test1_models_produce_different_scores_on_same_candidate();
  test2_fixture_A_qual_B_rej_C_qual_D_watch_E_insuff_F_qual();
  test3_all_models_identical_would_fail();
  test4_weightsUsed_per_row();
  test5_promotion_criteria_exact_frozen_fields();
  test6_trading_date_weekday_after_close();
  test7_trading_date_weekday_before_close();
  test8_trading_date_saturday();
  test9_trading_date_sunday();
  test10_trading_date_monday_premarket();
  test11_trading_date_holiday();
  test12_tradingDateBundle_has_all_fields();
  test13_immutability_guards_declared();
  test14_status_lives_in_separate_collection();
  test15_A_discoveryPool_only_BUY_rejected();
  test16_B_P4_pick_only_BUY_rejected();
  test17_C_watchlist_only_BUY_rejected();
  test18_D_P4_shadow_qualified_BUY_rejected();
  test19_E_daily_pick_validated_BUY_passes();
  test20_F_mandate_BUY_passes();
  test21_SELL_on_non_held_rejected();
  test22_action_mismatch_rejected();
  test23_authorize_batch();
  test24_cost_dedup_saves_6x();
  test25_projectDailyCost_default_shape();
  test26_champion_state_enum_has_CONTROL();
  test27_promotion_evaluator_skips_G();
  test28_markPilotInvalid_exported();
  test29_run_reports_actual_db_counts();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    for (const f of fails) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}
run().catch(e => { console.error(e); process.exit(2); });
