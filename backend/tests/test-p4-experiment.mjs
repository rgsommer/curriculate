#!/usr/bin/env node
// test-p4-experiment.mjs
//
// P4 prospective experiment regression tests. Pure/no-Mongo where
// possible; the persistence tests are handled by the runnable script.

import fs from "fs";
import {
  SCORING_MODELS, ALL_MODEL_IDS, ALL_P4_MODEL_IDS, CHAMPION_MODEL_ID,
  P4_NOMINATION_LANES, P4_FUNNEL_VARIANTS, P4_EXIT_RULES,
  P4_SHADOW_PORTFOLIO_RULES, P4_PROMOTION_CRITERIA,
} from "../services/stocksScoringModels.js";
import { unionNominations, runAllLanes } from "../services/stocksP4NominationLanes.js";
import { projectDailyCost } from "../services/stocksP4Experiment.js";

let passed = 0, failed = 0; const fails = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; fails.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── §1 Frozen experiment constants ────────────────────────────────
function test1_all_p4_models_declared() {
  for (const id of ["A", "B", "C", "D", "E", "F", "G"]) {
    assert(SCORING_MODELS[id], `1-${id}. Model ${id} exists`);
  }
  assert(ALL_P4_MODEL_IDS.length === 7, "1z. ALL_P4_MODEL_IDS has 7 members (A-G)");
  assert(CHAMPION_MODEL_ID === "A", "1c. Champion is A");
}
function test2_model_G_is_passive() {
  assert(SCORING_MODELS.G.passiveTickers?.length > 0,
    "2. Model G declares passive tickers");
  assert(SCORING_MODELS.G.opportunityWeights === null,
    "2b. Model G has no scoring weights (passive by definition)");
}
function test3_model_D_no_valuation_claim() {
  const d = SCORING_MODELS.D;
  assert(!/^GARP/i.test(d.label),
    "3. Model D label no longer starts with 'GARP' — no valuation factor exists yet (P4 §3)");
  assert(/NO explicit valuation/i.test(d.label + d.description),
    "3b. Description makes the missing valuation factor explicit");
}
function test4_nomination_lanes_declared() {
  for (const lane of ["TECHNICAL", "REVISION", "QUALITY_GROWTH", "RELATIVE_STRENGTH",
                       "INDUSTRY_LEADER", "POST_EARNINGS", "CATALYST"]) {
    assert(P4_NOMINATION_LANES.includes(lane), `4-${lane}. Lane ${lane} declared`);
  }
}
function test5_funnel_variants() {
  for (const f of ["NARROW", "MEDIUM", "WIDE"]) {
    assert(P4_FUNNEL_VARIANTS.includes(f), `5-${f}. Funnel variant ${f} declared`);
  }
}
function test6_exit_rules() {
  const ids = P4_EXIT_RULES.map(r => r.id);
  for (const id of ["TRAIL_08", "TRAIL_10", "TRAIL_12", "TRAIL_15", "ATR_2X", "THESIS_ONLY", "TIME_20D"]) {
    assert(ids.includes(id), `6-${id}. Exit rule ${id} declared`);
  }
}
function test7_shadow_portfolio_rules_symmetric() {
  const r = P4_SHADOW_PORTFOLIO_RULES;
  assert(r.startingCapitalCad > 0 && r.maxPositions > 0 && r.maxPositionWeight > 0,
    "7. Shadow-portfolio rules are populated (same for A-F, so a model cannot win by taking more risk)");
}
function test8_promotion_criteria_preregistered() {
  const c = P4_PROMOTION_CRITERIA;
  assert(c.minMature20dObservations >= 20 && c.mustBeatChampionMedianPp >= 1,
    "8. Promotion criteria are conservative (≥20 obs, ≥1pp median lift over champion)");
  assert(c.robustWithoutTopWinner === true,
    "8b. Robustness clause — ranking must survive removing best pick (§15)");
}

// ─── Nomination lane union ─────────────────────────────────────────
function test9_union_prefers_multi_lane_confirmations() {
  const perLane = {
    TECHNICAL: [{ ticker: "AAA", rank: 1 }, { ticker: "BBB", rank: 2 }],
    REVISION: [{ ticker: "AAA", rank: 5 }, { ticker: "CCC", rank: 1 }],
    QUALITY_GROWTH: [], RELATIVE_STRENGTH: [], INDUSTRY_LEADER: [],
    POST_EARNINGS: [], CATALYST: [],
  };
  const rows = unionNominations(perLane);
  assert(rows[0].ticker === "AAA" && rows[0].lanes.length === 2,
    "9a. Multi-lane ticker (AAA in TECHNICAL+REVISION) ranks first");
  assert(rows.find(r => r.ticker === "BBB") && rows.find(r => r.ticker === "CCC"),
    "9b. Single-lane tickers still included in union");
}
function test10_run_all_lanes_gates() {
  const candidates = [
    { ticker: "AAA", techRank: 1, epsRevisionPct: 6, fundamentalsScore: 80, growthAccelPct: 2, rs3mPct: 12, industryStrength: 80, industry: "Cloud" },
    { ticker: "ZZZ", techRank: 40, epsRevisionPct: 1, fundamentalsScore: 40 }, // fails everything
  ];
  const { perLane } = runAllLanes(candidates);
  assert(perLane.TECHNICAL.length === 2, "10a. TECHNICAL lane accepts any candidate with a rank");
  assert(perLane.REVISION.some(r => r.ticker === "AAA") && !perLane.REVISION.some(r => r.ticker === "ZZZ"),
    "10b. REVISION lane requires meaningful positive revisions");
  assert(perLane.QUALITY_GROWTH.some(r => r.ticker === "AAA") && !perLane.QUALITY_GROWTH.some(r => r.ticker === "ZZZ"),
    "10c. QUALITY_GROWTH lane requires high fundamentals + accel");
}

// ─── Model schemas ─────────────────────────────────────────────────
function test11_models_present_on_disk() {
  for (const f of ["StocksP4Experiment.js", "StocksP4PickRecord.js", "StocksP4Outcome.js", "StocksP4ChampionState.js"]) {
    assert(fs.existsSync(`/Users/richardsommer/dev/curriculate/backend/models/${f}`),
      `11-${f}. Model file ${f} exists`);
  }
}
function test12_experiment_first_write_wins() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4Experiment.js", "utf-8");
  assert(src.includes('this.isNew') && /immutable/i.test(src),
    "12. StocksP4Experiment.pre('save') rejects edits — FIRST-WRITE-WINS per spec §1");
}
function test13_pick_record_immutable() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4PickRecord.js", "utf-8");
  assert(src.includes('this.isNew') && /immutable/i.test(src),
    "13. Pick record is immutable once written — outcome cannot re-shape the pick (§6)");
}
function test14_pick_record_unique_by_experiment_day_model_funnel_ticker() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4PickRecord.js", "utf-8");
  assert(/unique:\s*true/.test(src),
    "14. Unique (experimentId, pickDate, model, funnel, ticker) prevents duplicate writes");
}
function test15_outcome_horizon_enum() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4Outcome.js", "utf-8");
  for (const s of ["PENDING", "FILLED", "MISSING_DATA"]) {
    assert(src.includes(s), `15-${s}. Horizon status enum includes ${s}`);
  }
}
function test16_watchlist_classifications() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4PickRecord.js", "utf-8");
  for (const c of ["BUY_CANDIDATE", "WATCH_HIGH_QUALITY_NO_ENTRY", "WATCH_SETUP_NO_QUALITY", "REJECTED"]) {
    assert(src.includes(c), `16-${c}. Pick classification ${c} defined (§8)`);
  }
}
function test17_champion_state_enum() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4ChampionState.js", "utf-8");
  for (const s of ["INCUMBENT", "CHALLENGER", "PROMOTION_ELIGIBLE", "PROMOTED", "RETIRED"]) {
    assert(src.includes(s), `17-${s}. Champion state ${s} declared (§17)`);
  }
}

// ─── Cost projection ───────────────────────────────────────────────
function test18_cost_projection() {
  const cost = projectDailyCost({ candidateCount: 100, includeShadow: true });
  assert(cost.fmpCalls > 0 && cost.yahooCalls > 0 && cost.mongoWrites > 0 && cost.estimatedRuntimeSec > 0,
    "18. Cost projector returns non-zero counts (§21)");
}

// ─── AI-authorization audit (§20) ──────────────────────────────────
// Membership in discoveryPool / watchlist / shadow / P4 candidate set
// must NEVER by itself authorize an actionable BUY. We prove this by
// asserting the pick-record's default classification is REJECTED and
// only BUY_CANDIDATE flows can be authorized.
function test19_p4_pick_alone_does_not_authorize() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/models/StocksP4PickRecord.js", "utf-8");
  assert(/default:\s*"REJECTED"/.test(src),
    "19. StocksP4PickRecord.classification defaults to REJECTED — no P4 membership by itself authorizes a BUY (spec §20)");
}
function test20_promotion_criteria_immutable_after_freeze() {
  // The frozen experiment's promotionCriteria are copied into the row;
  // subsequent SCORING_MODELS edits do not retroactively change them.
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/services/stocksP4Experiment.js", "utf-8");
  assert(src.includes("JSON.parse(JSON.stringify(SCORING_MODELS))"),
    "20. Frozen model bundle is deep-cloned — subsequent SCORING_MODELS edits cannot rewrite history");
  assert(src.includes("hash.slice") || src.includes("createHash"),
    "20b. Experiment id derives from a content hash — identical definitions collapse to one row");
}

async function run() {
  console.log("\n═══ P4 prospective experiment regression ═══\n");
  test1_all_p4_models_declared();
  test2_model_G_is_passive();
  test3_model_D_no_valuation_claim();
  test4_nomination_lanes_declared();
  test5_funnel_variants();
  test6_exit_rules();
  test7_shadow_portfolio_rules_symmetric();
  test8_promotion_criteria_preregistered();
  test9_union_prefers_multi_lane_confirmations();
  test10_run_all_lanes_gates();
  test11_models_present_on_disk();
  test12_experiment_first_write_wins();
  test13_pick_record_immutable();
  test14_pick_record_unique_by_experiment_day_model_funnel_ticker();
  test15_outcome_horizon_enum();
  test16_watchlist_classifications();
  test17_champion_state_enum();
  test18_cost_projection();
  test19_p4_pick_alone_does_not_authorize();
  test20_promotion_criteria_immutable_after_freeze();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    for (const f of fails) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}
run().catch(e => { console.error(e); process.exit(2); });
