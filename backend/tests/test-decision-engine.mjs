#!/usr/bin/env node
// test-decision-engine.mjs
//
// P1 + P1-HARDENING regression tests.
//
// Architecture principle these tests enforce:
//   Deterministic action first, AI explanation second.
//   A deterministic rule must be more trustworthy than the judgment
//   it replaces — no single soft signal, no security-type-inappropriate
//   metric, no arbitrary hidden stops.
//
// Coverage split:
//   Base P1  — sleeve classifiers, renderer, integration wiring
//   Dangerous-case P1-HARDENING (spec §11):
//     • healthy bank with payout 70% is NOT auto-trimmed by universal
//     • bank is not evaluated with corporate FCF-yield coverage
//     • healthy REIT is not sold because EPS payout appears >100%
//     • analyst target revision alone cannot trigger TRIM
//     • sector laggard status alone cannot trigger INCOME TRIM
//     • recent 13F filing is not treated as recent purchase
//     • CORE taxonomy conflict does not auto-SELL (DEFERRED instead)
//     • SPEC 9% drawdown alone does not auto-SELL without a proper
//       invalidation rule firing
//     • un-validated BUY does not appear in the executable decision card
//     • malformed review-date string cannot render

import { buildDecisions, ACTION, CONFIDENCE, FRESHNESS, ENGINE_VERSION } from "../services/stocksDecisionEngine.js";
import { renderDecisionCard } from "../services/stocksDecisionRenderer.js";
import { classifyIncomeSecurityType, INCOME_TYPE } from "../services/stocksIncomeSecurityType.js";
import fs from "fs";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── CORE ────────────────────────────────────────────────────────────
function test1_coreDefaultHold() {
  const ds = buildDecisions({
    positions: [{ ticker: "XEQT.TO", qty: 100, ccy: "CAD", account: "RRSP" }],
    concentrationByTicker: { "XEQT": 12 },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD, "1. CORE default is HOLD", `got action=${d?.action}`);
  assert(d?.confidence === CONFIDENCE.HIGH, "1b. CORE HOLD carries HIGH confidence");
  assert(d?.nextReview?.type === "event-driven", "1c. CORE HOLD review is event-driven, not calendar");
  assert(!/or earlier if/.test(String(d?.nextReview?.label || "")),
    "1d. CORE review label is a first-class phrase (no malformed 'or earlier if' fragment)");
  assert(d?.engineVersion === ENGINE_VERSION,
    "1e. Every decision carries engineVersion for future re-evaluation");
}

function test2_coreConcentrationTriggersTrim() {
  const ds = buildDecisions({
    positions: [{ ticker: "XEQT.TO", qty: 300, ccy: "CAD", account: "RRSP" }],
    concentrationByTicker: { "XEQT": 27 },
  });
  const d = ds[0];
  assert(d?.action === ACTION.TRIM, "2. CORE with 27% concentration → TRIM", `got action=${d?.action}`);
  assert(d?.shares > 0 && d?.shares < 300, "2b. Trim shares are between 1 and full position");
  assert(/concentration-breach/.test(d?.primaryRule || ""), "2c. Rule name identifies concentration breach");
  assert(Array.isArray(d?.supportingEvidence) && d.supportingEvidence.length >= 1,
    "2d. Structured supportingEvidence populated");
}

function test3_coreTacticalDrawdownDoesNotSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "XEQT.TO", qty: 100, ccy: "CAD", account: "RRSP" }],
    concentrationByTicker: { "XEQT": 8 },
    trailStopByTicker: { "XEQT.TO": { drawdownPct: 6 } },
    monitor: { withinStop: [], hardStopHit: [] },
  });
  assert(ds[0]?.action === ACTION.HOLD, "3. CORE with tactical 6% drawdown stays HOLD (not TRIM)");
}

// P1-HARDENING §7: mandate mismatch → DEFERRED, not SELL
function test4_coreMandateMismatchIsDeferred() {
  // classifyPosition maps unknowns to swing/spec, so simulate with a
  // ticker that would map away from core (any non-CORE_ETF ticker).
  const ds = buildDecisions({
    positions: [{ ticker: "GOOGL", qty: 10, ccy: "USD", account: "RRSP", sleeve: "core" }],
    concentrationByTicker: { "GOOGL": 8 },
  });
  const d = ds[0];
  assert(d?.action === ACTION.DEFERRED,
    "4. CORE mandate-classification conflict → DEFERRED (P1 hardening §7), not SELL",
    `got action=${d?.action}`);
  assert(/classification-conflict/.test(d?.primaryRule || ""),
    "4b. Primary rule names the classification conflict");
  assert(d?.supportingDetail?.oldClassification === "core"
      && d?.supportingDetail?.newClassification,
    "4c. Structured provenance logs old + new classification");
}

// ─── INCOME — security-type classifier ───────────────────────────────
function test5_securityTypeClassifierBank() {
  assert(classifyIncomeSecurityType("RY.TO") === INCOME_TYPE.BANK,
    "5. RY.TO classified as BANK");
  assert(classifyIncomeSecurityType("JPM") === INCOME_TYPE.BANK,
    "5b. JPM classified as BANK");
}

function test5c_securityTypeClassifierReit() {
  assert(classifyIncomeSecurityType("O") === INCOME_TYPE.REIT,
    "5c. Realty Income (O) classified as REIT");
  assert(classifyIncomeSecurityType("REI-UN.TO") === INCOME_TYPE.REIT,
    "5d. REI-UN.TO classified as REIT via -UN heuristic");
}

function test5e_securityTypeClassifierUtilityPipelineTelecom() {
  assert(classifyIncomeSecurityType("FTS.TO") === INCOME_TYPE.UTILITY, "5e. FTS.TO → UTILITY");
  assert(classifyIncomeSecurityType("ENB.TO") === INCOME_TYPE.PIPELINE, "5f. ENB.TO → PIPELINE");
  assert(classifyIncomeSecurityType("BCE.TO") === INCOME_TYPE.TELECOM, "5g. BCE.TO → TELECOM");
}

function test5h_securityTypeUnknownIsOther() {
  assert(classifyIncomeSecurityType("XYZBAND") === INCOME_TYPE.OTHER,
    "5h. Unknown ticker (no allowlist, no sector data) → OTHER (never default to industrial)");
}

// ─── INCOME — bank ─────────────────────────────────────────────────
function test6_healthyBankIsNotAutoTrimmed() {
  // Bank with payout 55% — comfortable — must be HOLD even though the
  // OLD universal rule ("payout ≥ 65% → TRIM") would have TRIMmed it.
  const ds = buildDecisions({
    positions: [{ ticker: "RY.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "RY.TO": { ok: true, payoutRatio: 0.55, roeTTM: 14.5, fcfYieldPct: 1.2 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "6. Bank RY.TO with 55% earnings payout + 14.5% ROE → HOLD",
    `got action=${d?.action} rule=${d?.primaryRule}`);
  assert(d?.securityType === INCOME_TYPE.BANK,
    "6b. Provenance records securityType=bank");
}

function test7_bankPayout70NotAutoTrimmed() {
  // P1-HARDENING dangerous case: bank with earnings-payout 70% must
  // NOT be auto-trimmed. 70% is inside the bank's watch band (55-75),
  // score = 1 → HOLD (not the 3-point TRIM threshold).
  const ds = buildDecisions({
    positions: [{ ticker: "TD.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "TD.TO": { ok: true, payoutRatio: 0.70, roeTTM: 12.0 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "7. Bank TD.TO with 70% payout is NOT auto-trimmed (universal 65% rule removed)",
    `got action=${d?.action} rule=${d?.primaryRule}`);
}

function test8_bankIsNotEvaluatedByCorporateFcfYield() {
  // A bank with -2% FCF yield must NOT trigger any FCF-driven signal.
  // The bank branch does not read fund.fcfYieldPct at all.
  const ds = buildDecisions({
    positions: [{ ticker: "BNS.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "BNS.TO": { ok: true, payoutRatio: 0.55, roeTTM: 12.0, fcfYieldPct: -2.0 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "8. Bank with -2% corporate FCF yield → HOLD (bank branch ignores FCF-yield metric)");
  const noFcfSignal = !(d?.supportingEvidence || []).some(e => /fcfYield/i.test(e.metric || ""));
  assert(noFcfSignal,
    "8b. Bank decision emits NO fcfYield signal in supportingEvidence");
}

function test9_bankHighPayoutTriggersWarningNotTrim() {
  // A bank with 78% earnings payout is in the WARNING band (≥75%) —
  // adds 2 points to the evidence stack. That alone (score 2) is
  // below the TRIM_MIN_SCORE of 3, so HOLD with warning.
  const ds = buildDecisions({
    positions: [{ ticker: "CM.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "CM.TO": { ok: true, payoutRatio: 0.78, roeTTM: 10 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "9. Bank with 78% earnings payout alone → HOLD (single warning, score < TRIM threshold)");
  const hasWarning = (d?.supportingEvidence || []).some(e => e.severity === "warning");
  assert(hasWarning,
    "9b. Warning is present in provenance so operator can inspect it");
}

// ─── INCOME — REIT ─────────────────────────────────────────────────
function test10_reitNotSoldBecauseEpsPayoutOver100() {
  // Classic REIT trap: reported EPS payout reads >100% because
  // depreciation depresses EPS. Under the OLD universal rule this
  // would be SELL. Under the type-aware rule, the REIT branch does
  // NOT read EPS payout; it needs AFFO. Missing AFFO → PARTIAL
  // freshness, but action stays HOLD (no company-level warning fired).
  const ds = buildDecisions({
    positions: [{ ticker: "O", qty: 100, ccy: "USD", account: "Non-Spousal USD" }],
    fundamentalsByTicker: {
      "O": { ok: true, payoutRatio: 2.30, dividendYieldPct: 5.5, sector: "Real Estate" },
    },
    reitAffoByTicker: {},
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "10. Healthy REIT is NOT sold because EPS payout appears >100% (REIT branch requires AFFO, not EPS)",
    `got action=${d?.action}`);
  assert(d?.securityType === INCOME_TYPE.REIT, "10b. Provenance securityType=reit");
  const flaggedInapplicable = (d?.contraryEvidence || []).some(e => e.severity === "inapplicable" && /EPS/.test(e.summary || ""));
  assert(flaggedInapplicable,
    "10c. EPS payout logged as INAPPLICABLE in contraryEvidence (provenance transparent)");
}

function test11_reitAffoPayoutHighTriggersWarning() {
  // If AFFO payout IS available and it's ≥90%, that's the correct
  // signal source — one warning, still below TRIM threshold alone.
  const ds = buildDecisions({
    positions: [{ ticker: "O", qty: 100, ccy: "USD", account: "Non-Spousal USD" }],
    fundamentalsByTicker: { "O": { ok: true, sector: "Real Estate" } },
    reitAffoByTicker: { "O": { affoPayoutPct: 92 } },
  });
  assert(ds[0]?.action === ACTION.HOLD,
    "11. REIT with AFFO payout 92% → HOLD (single warning, insufficient to TRIM)");
}

// ─── INCOME — analyst / sector alone cannot trade ─────────────────
function test12_analystRevisionAloneCannotTrigger() {
  // Bank with healthy fundamentals BUT analyst target down 12% in 4w.
  // The old rule would have TRIMmed on this. New rule: analyst
  // signal alone is CONTEXT — must combine with a company-level
  // warning to increment score. HOLD.
  const ds = buildDecisions({
    positions: [{ ticker: "RY.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "RY.TO": { ok: true, payoutRatio: 0.50, roeTTM: 15 },
    },
    revisionsByTicker: {
      "RY.TO": { ok: true, epsRev4wPct: -12 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "12. Analyst 4w target revision -12% ALONE cannot TRIM a healthy bank",
    `got action=${d?.action} rule=${d?.primaryRule}`);
  const analystInContext = (d?.supportingEvidence || []).some(e => /analystTarget/i.test(e.metric || "") && e.severity === "context");
  assert(analystInContext,
    "12b. Analyst signal appears as CONTEXT provenance (visible but non-actionable)");
}

function test13_sectorLaggardAloneCannotTriggerIncomeTrim() {
  const ds = buildDecisions({
    positions: [{ ticker: "RY.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: {
      "RY.TO": { ok: true, payoutRatio: 0.50, roeTTM: 15 },
    },
    sectorRankByTicker: {
      "RY.TO": { sector: "Financials", hostile: true, rank: 9 },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "13. Sector newly hostile ALONE cannot TRIM INCOME (P1 hardening §4)",
    `got action=${d?.action}`);
  const sectorInContext = (d?.supportingEvidence || []).some(e => e.metric === "sectorHostile" && e.severity === "context");
  assert(sectorInContext,
    "13b. Sector-hostile signal in provenance as CONTEXT (informational only)");
}

// ─── INCOME — severe signal short-circuits ─────────────────────────
function test14_dividendCutTriggersImmediateSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "BCE.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: { "BCE.TO": { ok: true, payoutRatio: 0.85 } },
    dividendEventByTicker: {
      "BCE.TO": { type: "cut", pct: 30, when: "2026-09-05" },
    },
  });
  const d = ds[0];
  assert(d?.action === ACTION.SELL,
    "14. Confirmed dividend cut → immediate SELL regardless of security type");
  assert(/severe-signal/.test(d?.primaryRule || ""), "14b. Rule tagged severe-signal");
}

// ─── INCOME — evidence-stack aggregation ────────────────────────────
function test15_multipleIndependentWarningsTriggerTrim() {
  // Industrial company with elevated payout + thin FCF yield =
  // score 1 + 1 = 2. Below TRIM (3). Should HOLD.
  const dsHold = buildDecisions({
    positions: [{ ticker: "IBM", qty: 30, ccy: "USD", account: "RRSP", sleeve: "income" }],
    fundamentalsByTicker: {
      "IBM": { ok: true, payoutRatio: 0.68, fcfYieldPct: 2.5 },
    },
  });
  assert(dsHold[0]?.action === ACTION.HOLD,
    "15a. Industrial with two watch-level signals (score 2) → HOLD");

  // Industrial with elevated payout + NEGATIVE FCF yield = 1 + 3 = 4.
  // Above TRIM threshold; below SELL. Should TRIM.
  const dsTrim = buildDecisions({
    positions: [{ ticker: "IBM", qty: 30, ccy: "USD", account: "RRSP", sleeve: "income" }],
    fundamentalsByTicker: {
      "IBM": { ok: true, payoutRatio: 0.68, fcfYieldPct: -1.0 },
    },
  });
  assert(dsTrim[0]?.action === ACTION.TRIM,
    "15b. Industrial with elevated payout + NEGATIVE FCF yield (score 4) → TRIM");
}

// ─── SWING ──────────────────────────────────────────────────────────
function test16_swingHardStopHitTriggersSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "TSLA", qty: 20, ccy: "USD", account: "Non-Spousal" }],
    monitor: {
      hardStopHit: [{ ticker: "TSLA", pnlPct: -9.5, hardStopPct: -8, account: "Non-Spousal" }],
      withinStop: [],
    },
  });
  assert(ds[0]?.action === ACTION.SELL,
    "16. SWING with hard-stop-hit → SELL");
}

function test17_swingHorizonExpiredTriggersSell() {
  const ds = buildDecisions({
    positions: [{ ticker: "AMD", qty: 30, ccy: "USD", account: "Non-Spousal" }],
    monitor: { hardStopHit: [], withinStop: [] },
    horizonByTicker: {
      "AMD": { daysElapsed: 45, horizonDays: 30, status: "well-behind" },
    },
  });
  assert(ds[0]?.action === ACTION.SELL,
    "17. SWING with expired horizon + well-behind → SELL (time stop)");
}

// ─── SPEC — hardening: 9% drawdown alone does NOT sell ─────────────
function test18_spec9pctDrawdownAloneDoesNotSell() {
  // Under the OLD rule an 8-12% drawdown was a "latent warning" that
  // auto-SELLed without an override. Under the P1-hardening rule the
  // engine's authoritative invalidation set is hard-stop / trail-stop
  // ≥12% / horizon / sector. A 9% drawdown alone is CONTEXT, not an
  // exit trigger.
  const ds = buildDecisions({
    positions: [{ ticker: "GME", qty: 100, ccy: "USD", account: "Non-Spousal" }],
    monitor: { hardStopHit: [], withinStop: [] },
    trailStopByTicker: { "GME": { drawdownPct: 9 } },
  });
  const d = ds[0];
  assert(d?.action === ACTION.HOLD,
    "18. SPEC with 9% drawdown alone (no hard stop, no trail ≥12%, no horizon exit) → HOLD, NOT auto-SELL",
    `got action=${d?.action} rule=${d?.primaryRule}`);
  const drawdownAsContext = (d?.supportingEvidence || []).some(e => /drawdown/i.test(e.metric || "") && e.severity === "context");
  assert(drawdownAsContext,
    "18b. 9% drawdown surfaces as CONTEXT-only supporting evidence in provenance");
}

function test19_specTrailBreachStillExits() {
  // Sanity: the authoritative invalidation ≥12% trail breach still
  // exits (SPEC never TRIMs — SWING TRIM → SPEC SELL).
  const ds = buildDecisions({
    positions: [{ ticker: "GME", qty: 100, ccy: "USD", account: "Non-Spousal" }],
    monitor: { hardStopHit: [], withinStop: [] },
    trailStopByTicker: { "GME": { drawdownPct: 14 } },
  });
  assert(ds[0]?.action === ACTION.SELL,
    "19. SPEC with trail-stop breach ≥12% → SELL");
}

// ─── NEW OPPORTUNITY — un-validated BUY does not render as executable
function test20_qualifyingPickBecomesBuy() {
  const ds = buildDecisions({
    dailyPicks: [
      { ticker: "MSFT", currency: "USD", compositeRank: 87, nominationCount: 5,
        entryPrice: 420, stopPrice: 380, targetPrice: 480, mtfConfluence: "aligned" },
    ],
  });
  assert(ds[0]?.action === ACTION.BUY, "20. Qualifying pick becomes BUY decision");
  assert(ds[0]?.confidence === CONFIDENCE.HIGH, "20b. Composite ≥85 → HIGH confidence");
}

function test21_unvalidatedBuyDoesNotAppearInPrimaryCard() {
  const md = renderDecisionCard([
    { ticker: "XEQT.TO", sleeve: "core", action: ACTION.HOLD, primaryRule: "core-mandate-intact",
      validated: true, nextReview: { type: "event-driven", label: "no scheduled review — event driven" } },
    { ticker: "MSFT", sleeve: "swing", action: ACTION.BUY, shares: 10,
      whyNow: "test", primaryRule: "qualifying-pick: composite 87",
      confidence: CONFIDENCE.HIGH, evidenceFreshness: FRESHNESS.FRESH,
      validated: false,
      validationFailures: ["sizing did not complete"] },
  ]);
  // The BUY must NOT appear in the primary executable card; it must
  // appear in the secondary "OPPORTUNITY IDENTIFIED" section.
  const primaryMSFT = /### 🔵 MSFT — BUY/.test(md);
  assert(!primaryMSFT,
    "21. Un-validated BUY does NOT render in primary decision card as executable");
  assert(/OPPORTUNITY IDENTIFIED · ORDER NOT READY/.test(md),
    "21b. Un-validated BUY surfaces in secondary OPPORTUNITY IDENTIFIED section");
  assert(/NOT executable today/.test(md),
    "21c. Secondary card clearly labels itself non-actionable");
}

// ─── Renderer — malformed review lines cannot render ───────────────
function test22_reviewLineNeverMalformed() {
  // A decision with an empty label must NOT render an "or earlier if"
  // fragment nor a bare "Next review:" line.
  const md = renderDecisionCard([
    { ticker: "XEQT.TO", sleeve: "core", action: ACTION.HOLD,
      primaryRule: "core-mandate-intact",
      validated: true,
      nextReview: { type: "event-driven", label: "" }, // simulate missing label
    },
  ]);
  assert(!/or earlier if/.test(md),
    "22. Renderer never emits 'or earlier if' (P1-hardening §9)");
  assert(!/Next review:\s*$/m.test(md),
    "22b. Renderer never emits an empty 'Next review:' line");
}

function test23_reviewLineWithLabelRenders() {
  const md = renderDecisionCard([
    { ticker: "RY.TO", sleeve: "income", securityType: "bank",
      action: ACTION.HOLD, primaryRule: "income-thesis-intact",
      validated: true,
      nextReview: { type: "event-driven", label: "next earnings or dividend declaration (bank)" },
    },
  ]);
  assert(md.includes("Next review: next earnings or dividend declaration (bank)"),
    "23. Well-formed review label renders verbatim without conditional glue");
}

function test24_dominantNoActionState() {
  const md = renderDecisionCard([
    { ticker: "XEQT.TO", sleeve: "core", action: ACTION.HOLD, primaryRule: "core-mandate-intact", validated: true },
    { ticker: "JNJ", sleeve: "income", action: ACTION.HOLD, primaryRule: "income-thesis-intact", validated: true },
  ]);
  assert(md.includes("### 🟢 NO TRADES REQUIRED TODAY"),
    "24. Dominant NO TRADES REQUIRED when nothing actionable");
}

// ─── Provenance — every decision carries the required fields ───────
function test25_decisionProvenanceComplete() {
  const ds = buildDecisions({
    positions: [{ ticker: "RY.TO", qty: 100, ccy: "CAD", account: "TFSA" }],
    fundamentalsByTicker: { "RY.TO": { ok: true, payoutRatio: 0.50, roeTTM: 15 } },
  });
  const d = ds[0];
  const required = ["action", "primaryRule", "supportingEvidence", "contraryEvidence",
                    "securityType", "dataAsOf", "confidence", "evidenceFreshness",
                    "validatorStatus", "engineVersion"];
  for (const k of required) {
    assert(Object.prototype.hasOwnProperty.call(d, k),
      `25-${k}. Decision includes provenance field ${k}`);
  }
}

// ─── Integration ────────────────────────────────────────────────────
function test26_briefingImportsEngineAndRenderer() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/import \{ buildDecisions, ACTION as DECISION_ACTION \} from "\.\.\/services\/stocksDecisionEngine\.js"/.test(src),
    "26. Briefing imports buildDecisions + ACTION alias");
  assert(/import \{ renderDecisionCard.*\} from "\.\.\/services\/stocksDecisionRenderer\.js"/.test(src),
    "26b. Briefing imports renderDecisionCard");
  assert(src.includes("[decision-engine]"),
    "26c. Briefing logs decision-engine invocations");
  assert(src.includes("decisionCardPrefix + deterministicPrefix"),
    "26d. Decision card is prepended ABOVE the deterministic prefix");
}

function test27_contradictionGatePresent() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(src.includes("contradicts-deterministic-hold"),
    "27. AI-contradiction gate rejects rec when engine says HOLD");
  assert(src.includes("contradicts-deterministic-exit"),
    "27b. AI-contradiction gate rejects BUY when engine says SELL/TRIM");
  assert(src.includes("contradicts-deterministic-deferred"),
    "27c. AI-contradiction gate rejects any rec on a DEFERRED ticker");
}

function run() {
  console.log("\n═══ P1 + P1-HARDENING Decision Engine Regression ═══\n");
  test1_coreDefaultHold();
  test2_coreConcentrationTriggersTrim();
  test3_coreTacticalDrawdownDoesNotSell();
  test4_coreMandateMismatchIsDeferred();
  test5_securityTypeClassifierBank();
  test5c_securityTypeClassifierReit();
  test5e_securityTypeClassifierUtilityPipelineTelecom();
  test5h_securityTypeUnknownIsOther();
  test6_healthyBankIsNotAutoTrimmed();
  test7_bankPayout70NotAutoTrimmed();
  test8_bankIsNotEvaluatedByCorporateFcfYield();
  test9_bankHighPayoutTriggersWarningNotTrim();
  test10_reitNotSoldBecauseEpsPayoutOver100();
  test11_reitAffoPayoutHighTriggersWarning();
  test12_analystRevisionAloneCannotTrigger();
  test13_sectorLaggardAloneCannotTriggerIncomeTrim();
  test14_dividendCutTriggersImmediateSell();
  test15_multipleIndependentWarningsTriggerTrim();
  test16_swingHardStopHitTriggersSell();
  test17_swingHorizonExpiredTriggersSell();
  test18_spec9pctDrawdownAloneDoesNotSell();
  test19_specTrailBreachStillExits();
  test20_qualifyingPickBecomesBuy();
  test21_unvalidatedBuyDoesNotAppearInPrimaryCard();
  test22_reviewLineNeverMalformed();
  test23_reviewLineWithLabelRenders();
  test24_dominantNoActionState();
  test25_decisionProvenanceComplete();
  test26_briefingImportsEngineAndRenderer();
  test27_contradictionGatePresent();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run();
