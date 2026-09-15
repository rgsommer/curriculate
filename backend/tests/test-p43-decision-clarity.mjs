#!/usr/bin/env node
// test-p43-decision-clarity.mjs
//
// P4.3 decision-clarity regression. Pure/no-Mongo where possible.

import fs from "fs";
import { resolveTrailStopReview, ACTION, renderResolvedDecision } from "../services/stocksTrailStopResolver.js";
import { classifyPriceFreshness, marketSessionAt, FRESHNESS } from "../services/stocksPriceFreshness.js";
import { buildDecisionCard } from "../services/stocksDecisionCard.js";
import { authorizeRecommendation } from "../services/stocksActionAuthorization.js";

let passed = 0, failed = 0; const fails = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; fails.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── §1  Trail-stop resolver emits ONE action per input ────────────
function test1_spec_below_stop_sells() {
  const r = resolveTrailStopReview({
    ticker: "DJT", sleeve: "spec", currency: "USD",
    position: { qty: 234, account: "TFSA (60367867)" },
    currentPrice: 8.88, trailStopPrice: 9.10, peakPrice: 10.38, drawdownFromPeakPct: -14.3,
  });
  assert(r.action === ACTION.SELL, `1. SPEC below stop + drawdown 14.3% → SELL`, `got ${r.action}`);
  assert(r.reasonCodes.includes("spec-trail-breach-plus-drawdown"),
    "1b. Reason code names the rule that fired");
  assert(r.sizingHint?.qty === 234, "1c. Sizing hint = full position for SELL");
}

function test2_swing_touched_but_shallow_holds() {
  const r = resolveTrailStopReview({
    ticker: "NVDA", sleeve: "swing", currency: "USD",
    position: { qty: 25, account: "RRSP (59659702)" },
    currentPrice: 212.50, trailStopPrice: 212.50, peakPrice: 230.36, drawdownFromPeakPct: -7.7,
  });
  // At-the-stop with drawdown < 12% is not below the stop and not
  // above the drawdown threshold → the deterministic rule is HOLD.
  // (SWING at-stop TIGHTEN only fires on stopBreached=true.)
  assert(r.action === ACTION.HOLD, `2. SWING at stop, drawdown 7.7% (< 12% hard threshold) → HOLD`, `got ${r.action}`);
  assert(r.invalidationTrigger && r.invalidationTrigger.length > 0,
    "2b. HOLD carries an explicit invalidation trigger (not 'thesis intact')");
  assert(r.nextReviewDate && /^\d{4}-\d{2}-\d{2}$/.test(r.nextReviewDate),
    "2c. HOLD carries an explicit nextReviewDate");
}

function test3_income_missing_evidence_defers() {
  const r = resolveTrailStopReview({
    ticker: "RY", sleeve: "income", currency: "CAD",
    position: { qty: 18, account: "Non-Spousal (59659702)" },
    currentPrice: 285.19, trailStopPrice: 294.32, peakPrice: 305.74, drawdownFromPeakPct: -6.8,
    evidence: {},  // no dividend coverage / payout / sector view supplied
  });
  assert(r.action === ACTION.DEFERRED,
    `3. INCOME with missing evidence → DEFERRED (never guess)`, `got ${r.action}`);
  assert(r.deferredReason && /dividend|coverage|payout|sector/i.test(r.deferredReason),
    "3b. Deferred reason names the specific missing input");
}

function test4_income_thesis_intact_holds() {
  const r = resolveTrailStopReview({
    ticker: "RY", sleeve: "income", currency: "CAD",
    position: { qty: 18, account: "Non-Spousal" },
    currentPrice: 285.19, trailStopPrice: 294.32, peakPrice: 305.74, drawdownFromPeakPct: -6.8,
    evidence: { dividendCoverageRatio: 1.6, payoutRatioPct: 55, sectorViewIntact: true },
  });
  assert(r.action === ACTION.HOLD, `4. INCOME thesis intact + drawdown 6.8% → HOLD`, `got ${r.action}`);
  assert(r.confidence === "HIGH", "4b. HIGH confidence when all evidence lines up");
}

function test5_income_dividend_cut_sells() {
  const r = resolveTrailStopReview({
    ticker: "XYZ", sleeve: "income", currency: "USD",
    position: { qty: 100, account: "acct" },
    currentPrice: 10, trailStopPrice: 11, peakPrice: 12, drawdownFromPeakPct: -16.7,
    evidence: { dividendCoverageRatio: 0.7, payoutRatioPct: 145, sectorViewIntact: true, dividendCutOrSuspended: true },
  });
  assert(r.action === ACTION.SELL, `5. INCOME dividend-cut severe signal → SELL immediately`, `got ${r.action}`);
}

function test6_core_always_holds() {
  const r = resolveTrailStopReview({
    ticker: "XEQT.TO", sleeve: "core", currency: "CAD",
    position: { qty: 100, account: "a1" },
    currentPrice: 44, trailStopPrice: 45.5, peakPrice: 46, drawdownFromPeakPct: -4.3,
  });
  assert(r.action === ACTION.HOLD, "6. CORE ETFs — trail-stop is informational only → HOLD");
}

function test7_hard_stop_hit_wins() {
  const r = resolveTrailStopReview({
    ticker: "AAA", sleeve: "swing", currency: "USD",
    position: { qty: 50 }, currentPrice: 5, trailStopPrice: 10, peakPrice: 12,
    drawdownFromPeakPct: -58, hardStopHit: true,
  });
  assert(r.action === ACTION.SELL, "7. hardStopHit short-circuits every sleeve → SELL");
  assert(r.reasonCodes[0] === "hard-stop-hit", "7b. Reason code = hard-stop-hit");
}

// ─── §2  No "decide today" homework in the output ──────────────────
function test8_output_never_asks_user_to_decide() {
  const r = resolveTrailStopReview({
    ticker: "DJT", sleeve: "spec", currency: "USD",
    position: { qty: 100 }, currentPrice: 8, trailStopPrice: 9, peakPrice: 10.4,
    drawdownFromPeakPct: -23,
  });
  const rendered = renderResolvedDecision("DJT", r, { qty: 100, account: "a3" });
  assert(!/decide today/i.test(rendered), "8. Rendered output does not say 'decide today'");
  assert(!/is the payout still safe/i.test(rendered), "8b. Rendered output does not ask the user");
  assert(!/HOLD requires a specific/i.test(rendered), "8c. No 'HOLD requires' homework prompt");
}

// ─── §3  Phantom-XLU guard: SELL wording only when held ────────────
function test9_stop_alert_wording_gated_on_held() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js", "utf-8");
  assert(src.includes("p43HeldBaseSet"), "9. Held-set collected inside monitorOpenRecs");
  assert(src.includes("CLOSED REC OUTCOME"), "9b. Non-held stop-hit renders as CLOSED REC OUTCOME");
  assert(/isHeldNow[\s\S]{0,200}SELL the position/.test(src),
    "9c. 'SELL the position' clause gated on isHeldNow=true");
}

// ─── §4  Price freshness labeling ──────────────────────────────────
function test10_price_freshness_open_and_live() {
  // Wed 2026-09-16 15:00 ET (14:59+ session hours in EDT = 19:00 UTC)
  const now = new Date("2026-09-16T19:00:00Z");
  const priceAsOf = new Date("2026-09-16T18:59:45Z");  // 15s old
  const c = classifyPriceFreshness({ priceAsOf, now });
  assert(c.freshnessClass === FRESHNESS.LIVE, `10. Fresh quote during OPEN session → LIVE`, `got ${c.freshnessClass}`);
  assert(c.label === "(live)", "10b. Renders '(live)'");
}
function test11_price_freshness_delayed_15min() {
  const now = new Date("2026-09-16T19:00:00Z");
  const priceAsOf = new Date("2026-09-16T18:50:00Z");  // 10 min old
  const c = classifyPriceFreshness({ priceAsOf, now });
  assert(c.freshnessClass === FRESHNESS.INTRADAY_DELAYED,
    "11. 10-min-old quote during OPEN → INTRADAY_DELAYED", `got ${c.freshnessClass}`);
  assert(/delayed/.test(c.label), "11b. Label includes 'delayed'");
}
function test12_price_freshness_weekend_prev_close() {
  const now = new Date("2026-09-12T15:00:00Z");    // Sat
  const priceAsOf = new Date("2026-09-11T20:00:00Z"); // Fri close
  const c = classifyPriceFreshness({ priceAsOf, now });
  assert(c.freshnessClass === FRESHNESS.PREV_CLOSE,
    "12. Weekend + Fri close → PREV_CLOSE", `got ${c.freshnessClass}`);
  assert(/previous close/.test(c.label), "12b. Label reads 'previous close'");
}
function test13_price_freshness_stale_during_open() {
  const now = new Date("2026-09-16T19:00:00Z");
  const priceAsOf = new Date("2026-09-16T17:00:00Z"); // 2h old during OPEN
  const c = classifyPriceFreshness({ priceAsOf, now });
  assert(c.freshnessClass === FRESHNESS.STALE, "13. 2h-old quote during OPEN → STALE");
  assert(/STALE/.test(c.label), "13b. Label reads 'STALE'");
}
function test14_price_freshness_never_lies() {
  // The whole point — never render "live" for a stale price.
  const now = new Date("2026-09-16T19:00:00Z");
  const priceAsOf = new Date("2026-09-16T16:00:00Z"); // 3h old
  const c = classifyPriceFreshness({ priceAsOf, now });
  assert(c.label !== "(live)", "14. Stale price NEVER gets 'live' label");
}
function test15_marketSessionAt_boundary() {
  const sat = marketSessionAt(new Date("2026-09-12T15:00:00Z"));
  const sun = marketSessionAt(new Date("2026-09-13T15:00:00Z"));
  const mon930 = marketSessionAt(new Date("2026-09-14T13:29:00Z")); // 9:29am ET
  const mon931 = marketSessionAt(new Date("2026-09-14T13:31:00Z")); // 9:31am ET
  assert(sat === "CLOSED_WEEKEND" && sun === "CLOSED_WEEKEND", "15. Weekend classified as CLOSED_WEEKEND");
  assert(mon930 === "PRE_MARKET", "15b. 9:29 ET → PRE_MARKET");
  assert(mon931 === "OPEN", "15c. 9:31 ET → OPEN");
}

// ─── §6  Decision card renders top-of-brief block ──────────────────
function test16_decision_card_shape() {
  const card = buildDecisionCard({
    resolvedReviews: [
      { ticker: "DJT", account: "a3", qty: 234, action: "SELL", sizingHint: { qty: 234, percent: 100 } },
      { ticker: "NVDA", account: "a2", qty: 25, action: "HOLD", nextReviewDate: "2026-09-28" },
      { ticker: "RY", account: "a1", qty: 18, action: "DECISION_DEFERRED", deferredReason: "coverage data missing" },
    ],
    newBuyCount: 0,
    deferredNotes: [],
  });
  assert(/WHAT DO I DO TODAY/.test(card.markdown), "16. Card renders the top heading");
  assert(card.entries[0].action === "SELL", "16b. Entries sorted with SELL first");
  assert(/DJT[^\n]*SELL 234/.test(card.markdown), "16c. DJT SELL line rendered");
  assert(/NVDA[^\n]*HOLD/.test(card.markdown), "16d. NVDA HOLD line rendered (resolved review closes the loop)");
  assert(/DECISION DEFERRED/.test(card.markdown), "16e. DECISION DEFERRED for RY appears verbatim");
  assert(/NEW BUY   NONE/.test(card.markdown), "16f. NEW BUY = NONE when count is 0");
}
function test17_decision_card_empty_state() {
  const card = buildDecisionCard({ resolvedReviews: [], newBuyCount: 0 });
  assert(/NO POSITION ACTIONS TODAY/.test(card.markdown),
    "17. Empty resolved-reviews list renders 'NO POSITION ACTIONS TODAY'");
}
function test18_decision_card_new_buy_count() {
  const card = buildDecisionCard({ resolvedReviews: [], newBuyCount: 2 });
  assert(/NEW BUY   2 qualifying picks/.test(card.markdown),
    "18. NEW BUY line shows count when > 0");
}

// ─── §7  MANDATORY ACTIONS contains only actions ───────────────────
function test19_mandatory_never_holds_review_text() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js", "utf-8");
  // The old "Decide today and record ONE of" wording must be gone.
  assert(!/Decide today and record ONE of/.test(src),
    "19. 'Decide today and record ONE of' text removed from mandate composer");
  assert(!/is the payout still safe/.test(src),
    "19b. INCOME 'is the payout still safe' homework removed");
  assert(src.includes("**SELL**") || src.includes("**TRIM**") || src.includes("**TIGHTEN STOP**"),
    "19c. Composer emits concrete action lines instead");
}

// ─── §3  End-to-end phantom XLU guard through action authorization ─
function test20_p4_authorization_still_blocks_non_held_sell() {
  // Belt-and-braces: even if a briefing produced a SELL wording for a
  // non-held ticker, the authorizeRecommendation guard would still
  // reject it because the ticker isn't in heldTickers.
  const held = new Set(["DJT", "NVDA", "RY"]);
  const r = authorizeRecommendation({
    action: "SELL", ticker: "XLU",
    source: "HOLD_CLASSIFIER", classifierAction: "SELL",
    heldTickers: held,
  });
  assert(!r.authorized && r.reason.includes("non-held"),
    "20. Non-held SELL still blocked by the action-authorization guard end-to-end");
}

// ─── §5  Redeployment revalidation policy preserved ────────────────
function test21_redeployment_still_requires_settled_proceeds() {
  const src = fs.readFileSync("/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js", "utf-8");
  assert(src.includes("validateMandateFunding"),
    "21. Pre-LLM funding validator still runs — redeployments can't spend more than validated proceeds");
  assert(/IF EXIT — REDEPLOY/.test(src),
    "21b. Paired IF-EXIT REDEPLOY wording preserved (revalidation-at-execute contract intact)");
}

async function run() {
  console.log("\n═══ P4.3 decision-clarity regression ═══\n");
  test1_spec_below_stop_sells();
  test2_swing_touched_but_shallow_holds();
  test3_income_missing_evidence_defers();
  test4_income_thesis_intact_holds();
  test5_income_dividend_cut_sells();
  test6_core_always_holds();
  test7_hard_stop_hit_wins();
  test8_output_never_asks_user_to_decide();
  test9_stop_alert_wording_gated_on_held();
  test10_price_freshness_open_and_live();
  test11_price_freshness_delayed_15min();
  test12_price_freshness_weekend_prev_close();
  test13_price_freshness_stale_during_open();
  test14_price_freshness_never_lies();
  test15_marketSessionAt_boundary();
  test16_decision_card_shape();
  test17_decision_card_empty_state();
  test18_decision_card_new_buy_count();
  test19_mandatory_never_holds_review_text();
  test20_p4_authorization_still_blocks_non_held_sell();
  test21_redeployment_still_requires_settled_proceeds();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    for (const f of fails) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}
run().catch(e => { console.error(e); process.exit(2); });
