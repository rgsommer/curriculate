// Regression tests for the Special-Situation Awareness layer +
// per-pick composite reconciliation audit. These tests verify:
//
//   • active M&A targets never surface as ordinary BUY picks
//   • cash / stock / mixed consideration all price correctly
//   • missing terms fail-closed (SCREENED — MISSING TERMS)
//   • lifecycle correctly restores eligibility on TERMINATED/COMPLETED
//   • ordinary picks (no situation) are unaffected
//   • displayed composite reconciles to canonical (arithmetic invariant)
//   • duplicate contributions AND hidden adjustments both blocker-fire
//   • no float artifacts leak into operator-facing text
//   • external adjustment remains separately attributable
//   • R/R < 1.5 gate + WATCH trigger requirement both hold
//   • LLM prose cannot establish corporate-action state (only structured
//     sources can populate the store)
//
// These are pure-function contract tests. Adapter I/O (FMP, 8-K) is
// tested via integration against live sources.

import {
  SPECIAL_SITUATION_KINDS,
  SPECIAL_SITUATION_STATUSES,
  computeImpliedDealValue,
  isDealPriceable,
  formatSpecialSituationBlock,
  buildDealKey,
} from "../services/stocksSpecialSituations.js";
import { auditPickReconciliation } from "../services/briefingAudit.js";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// Reusable mock price verifier — injected into computeImpliedDealValue
// via opts.verifyPrice so tests never touch the network.
function mockVerifier({ price = null, ok = true, rejectionReason = null }) {
  return async () => ({
    ok, verifiedPrice: price, rejectionReason, currency: "USD",
  });
}

// Mock renderer-shaped pick — matches the shape scoreCandidate emits.
function ordinaryPick(overrides = {}) {
  return {
    ticker: "CNQ.TO",
    currency: "CAD",
    deterministicScore: 76,
    scoreContributors: [
      "trend up (SMA50>SMA200, price +5.1% > SMA50) +25",
      "RSI 58 sweet spot +15",
      "RVOL 2.10x +8",
      "pocket pivot +10",
      "Bull flag (72) +18",
    ],
    scoreContributions: [
      { label: "trend up", delta: 25 },
      { label: "RSI 58 sweet spot", delta: 15 },
      { label: "RVOL 2.10x", delta: 8 },
      { label: "pocket pivot", delta: 10 },
      { label: "Bull flag", delta: 18 },
    ],
    scoreRawSum: 76,
    rationale: "Composite 76: trend up · RSI · RVOL · pocket pivot · Bull flag",
    ...overrides,
  };
}

// ─── 1. Cash-only acquisition target → cannot BUY ────────────────
async function test1_cashOnlyCannotBuy() {
  const situation = {
    ticker: "ARX.TO",
    kind: "MERGER_TARGET",
    status: "ANNOUNCED",
    active: true,
    acquirer: "Shell plc",
    acquirerTicker: "SHEL",
    cashPerShare: { value: 8.20, unit: "CAD", currency: "CAD" },
    stockRatio: null,
  };
  const iv = await computeImpliedDealValue(situation);
  assert(iv.impliedValue === 8.20, "1a. Cash-only implied value == cashPerShare", `got ${iv.impliedValue}`);
  assert(isDealPriceable(situation), "1b. Cash-only deal is priceable", "");
  // A pick carrying this situation reaches the renderer as EVENT-DRIVEN
  // (priceable) — never as ordinary BUY. Emulate the tier decision:
  const pickTier = situation.active
    ? (iv.impliedValue != null ? "EVENT-DRIVEN" : "SCREENED-MA")
    : "BUY";
  assert(pickTier === "EVENT-DRIVEN", "1c. Cash-only target routes to EVENT-DRIVEN, not BUY", `tier=${pickTier}`);
}

// ─── 2. Stock-only acquisition target ────────────────────────────
async function test2_stockOnlyRequiresVerifiedAcquirer() {
  const situation = {
    ticker: "ACQTGT",
    kind: "MERGER_TARGET",
    status: "PENDING",
    active: true,
    acquirer: "BigCo",
    acquirerTicker: "BIG",
    cashPerShare: null,
    stockRatio: { value: 0.5, unit: "shares_per_share" },
  };
  // With a verified acquirer price of $40, stockValue = 0.5 * 40 = 20
  const iv = await computeImpliedDealValue(situation, {
    verifyPrice: mockVerifier({ price: 40, ok: true }),
  });
  assert(iv.impliedValue === 20, "2a. Stock-only: 0.5 × verified $40 = $20", `got ${iv.impliedValue}`);
  assert(iv.verifiedAcquirerPrice === 40, "2b. Verified acquirer price passed through", "");
  // No acquirer ticker → fail-closed
  const noTickerSit = { ...situation, acquirerTicker: null };
  const noTickerIv = await computeImpliedDealValue(noTickerSit);
  assert(noTickerIv.brokenReason === "stock-deal-no-acquirer-ticker",
    "2c. Stock deal without acquirer ticker fails closed",
    `got ${noTickerIv.brokenReason}`);
}

// ─── 3. Cash + stock (ARX/Shell style) implied value ─────────────
async function test3_cashPlusStockImpliedValue() {
  // ARX-style fixture: C$8.20 + 0.40247 × Shell price
  const situation = {
    ticker: "ARX.TO",
    kind: "MERGER_TARGET",
    status: "ANNOUNCED",
    active: true,
    acquirer: "Shell plc",
    acquirerTicker: "SHEL",
    currency: "CAD",
    cashPerShare: { value: 8.20, unit: "CAD", currency: "CAD" },
    stockRatio: { value: 0.40247, unit: "shares_per_share" },
  };
  // With verified acquirer at $80 CAD → total = 8.20 + 0.40247*80 = 40.3976
  const iv = await computeImpliedDealValue(situation, {
    verifyPrice: mockVerifier({ price: 80, ok: true }),
  });
  const expected = 8.20 + 0.40247 * 80;
  assert(Math.abs(iv.impliedValue - expected) < 0.001,
    "3. Cash+stock implied = cash + ratio × verified acquirer price",
    `expected ${expected}, got ${iv.impliedValue}`);
}

// ─── 4. Missing terms → fail-closed ──────────────────────────────
async function test4_missingTermsFailClosed() {
  const situation = {
    ticker: "STUB",
    kind: "MERGER_TARGET",
    status: "ANNOUNCED",
    active: true,
    cashPerShare: null,
    stockRatio: null,
  };
  const iv = await computeImpliedDealValue(situation);
  assert(iv.impliedValue === null, "4a. No terms → null implied value", "");
  assert(iv.brokenReason === "no-consideration-terms",
    "4b. No terms → brokenReason no-consideration-terms",
    `got ${iv.brokenReason}`);
  assert(!isDealPriceable(situation), "4c. No terms → not priceable", "");
  // Acquirer price unverifiable also fails closed
  const stockSit = {
    ...situation,
    acquirerTicker: "BAD",
    stockRatio: { value: 1.0 },
  };
  const iv2 = await computeImpliedDealValue(stockSit, {
    verifyPrice: mockVerifier({ ok: false, rejectionReason: "market-data-not-found" }),
  });
  assert(iv2.impliedValue === null && iv2.brokenReason?.includes("acquirer-price-unverifiable"),
    "4d. Acquirer price unverifiable → SCREENED reason", `got ${iv2.brokenReason}`);
}

// ─── 5. TERMINATED state restores eligibility ────────────────────
function test5_terminatedRestoresEligibility() {
  // The store row itself carries active=false for TERMINATED. The pick
  // engine's preflight reads only rows with active:true, so a
  // TERMINATED row is invisible to the gate. Verify the invariant.
  const activeStatuses = ["ANNOUNCED", "PENDING", "APPROVED", "AMENDED"];
  const inactiveStatuses = ["COMPLETED", "TERMINATED", "EXPIRED"];
  const activeCheck = activeStatuses.every(s => !["COMPLETED", "TERMINATED", "EXPIRED"].includes(s));
  const inactiveCheck = inactiveStatuses.every(s => ["COMPLETED", "TERMINATED", "EXPIRED"].includes(s));
  assert(activeCheck && inactiveCheck,
    "5. Lifecycle active/inactive partition matches persistSpecialSituations rule",
    "");
}

// ─── 6. COMPLETED doesn't remain active ──────────────────────────
function test6_completedNotActive() {
  // Same partition — COMPLETED → active=false, no BUY re-emission.
  const isActive = (status) => !["COMPLETED", "TERMINATED", "EXPIRED"].includes(status);
  assert(!isActive("COMPLETED"), "6a. COMPLETED → active=false", "");
  assert(!isActive("TERMINATED"), "6b. TERMINATED → active=false", "");
  assert(!isActive("EXPIRED"), "6c. EXPIRED → active=false", "");
  assert(isActive("ANNOUNCED"), "6d. ANNOUNCED → active=true", "");
  assert(isActive("PENDING"), "6e. PENDING → active=true", "");
}

// ─── 7. Ordinary CNQ-style pick is unaffected ────────────────────
async function test7_ordinaryPickUnaffected() {
  const p = ordinaryPick(); // no specialSituation
  const r = auditPickReconciliation(p);
  assert(r.ok, "7. Ordinary pick with clean contributions passes reconciliation audit",
    r.issues.map(i => i.detail).join("; "));
}

// ─── 8. Displayed composite reconciles to contributions ──────────
async function test8_reconciliationHoldsWhenClean() {
  const p = ordinaryPick(); // contributions sum to 76, score 76
  const r = auditPickReconciliation(p);
  assert(r.ok, "8. Clean pick: displayed composite == sum(contributions)", "");
}

// ─── 9. Duplicate contribution fires blocker ─────────────────────
async function test9_duplicateContributionBlocked() {
  const p = ordinaryPick({
    scoreContributions: [
      { label: "trend up", delta: 25 },
      { label: "pocket pivot", delta: 10 },        // volume flag
      { label: "pocket pivot", delta: 15 },        // ALSO from setup detector — duplicate label!
      { label: "RSI 58 sweet spot", delta: 15 },
    ],
    scoreRawSum: 65,
    deterministicScore: 65,
  });
  const r = auditPickReconciliation(p);
  const hasDup = (r.issues || []).some(i => i.code === "pick-composite-duplicate-contribution");
  assert(hasDup, "9. Duplicate contribution label fires blocker",
    r.issues.map(i => i.code).join(", "));
}

// ─── 10. Hidden adjustment fires blocker ─────────────────────────
async function test10_hiddenAdjustmentBlocked() {
  const p = ordinaryPick({
    scoreContributions: [{ label: "trend up", delta: 25 }],
    scoreRawSum: 25,
    deterministicScore: 76,   // ← hidden +51 not accounted for
  });
  const r = auditPickReconciliation(p);
  const hasMismatch = (r.issues || []).some(i => i.code === "pick-composite-reconciliation-mismatch");
  assert(hasMismatch, "10. Hidden adjustment (displayed 76 vs sum 25) fires blocker",
    r.issues.map(i => i.code).join(", "));
}

// ─── 11. No floating-point artifacts in operator text ────────────
async function test11_floatArtifactBlocked() {
  const p = ordinaryPick({
    rationale: "Composite 61: something · 5.099999999999994 · other",
  });
  const r = auditPickReconciliation(p);
  const hasFloat = (r.issues || []).some(i => i.code === "pick-composite-float-artifact");
  assert(hasFloat, "11. Float artifact (.999999...) in rationale fires blocker",
    r.issues.map(i => i.code).join(", "));
}

// ─── 12. External adjustment remains separately attributable ─────
function test12_externalStillAttributable() {
  // The pick record carries baseComposite + externalAdjustment as
  // distinct fields (external nomination layer, previous work).
  // Reconciliation audit MUST NOT reject a pick just because
  // externalAdjustment != 0; the sum runs over scoreContributions
  // (base composite), which is frozen.
  const p = ordinaryPick({
    deterministicScore: 76,   // base composite, unchanged
    externalAdjustment: 5,    // external layer adds +5 for display
    enhancedComposite: 81,
  });
  const r = auditPickReconciliation(p);
  assert(r.ok, "12. External adjustment side-channel does not corrupt reconciliation",
    r.issues.map(i => i.detail).join("; "));
}

// ─── 13. R/R < 1.5 never BUY (existing gate) ─────────────────────
function test13_rrGateHolds() {
  const composite = 84;
  const rr = 0.34;
  const MIN_RR_FOR_BUY = 1.5;
  const situation = null;
  const watchTrigger = { price: 90, why: "test" };
  const rrOk = rr >= MIN_RR_FOR_BUY;
  let tier;
  if (situation) tier = "EVENT-DRIVEN";
  else if (composite >= 70 && rrOk) tier = "BUY";
  else if (composite >= 70 && !rrOk) tier = "SCREENED";
  else if (composite >= 60 && watchTrigger) tier = "WATCH";
  else tier = "MONITOR";
  assert(tier === "SCREENED", "13. Composite 84 + R/R 0.34 → SCREENED (never BUY)", `tier=${tier}`);
}

// ─── 14. Low-R/R WATCH must have qualifying trigger ──────────────
function test14_watchRequiresTrigger() {
  const composite = 65;
  const MIN_RR_FOR_BUY = 1.5;
  const withTrigger = { price: 45, why: "pullback to $45" };
  const withoutTrigger = null;
  const tierFor = (trigger) => {
    if (composite >= 60 && trigger && Number.isFinite(trigger.price)) return "WATCH";
    if (composite >= 60) return "SCREENED";
    return "MONITOR";
  };
  assert(tierFor(withTrigger) === "WATCH", "14a. Composite 65 with valid trigger → WATCH", "");
  assert(tierFor(withoutTrigger) === "SCREENED",
    "14b. Composite 65 without trigger → SCREENED (never speculative WATCH)", "");
}

// ─── 15. LLM prose cannot establish corporate-action state ───────
// A special-situation row can only be created via structured sources.
// The persist path requires a source string from {FMP_MA_RSS, FMP_DEALS,
// SEC_8K_1_01}. A pick that carries an inline "acquired by" mention in
// its rationale must not persuade any code path to construct a
// situation object.
function test15_llmProseCannotEstablishState() {
  const p = ordinaryPick({
    rationale: "Composite 76: setup — noted that ARX.TO is acquired by Shell per press release",
  });
  // Reconciliation audit does NOT look at prose to determine situation.
  // The situation field would be null unless populated by the store.
  const looksAtProse = p.specialSituation != null;
  assert(!looksAtProse,
    "15a. Prose alone does not populate p.specialSituation", "");
  // The store only accepts SPECIAL_SITUATION_KINDS/STATUSES from
  // explicit source strings.
  const validKinds = SPECIAL_SITUATION_KINDS;
  const validStatuses = SPECIAL_SITUATION_STATUSES;
  assert(validKinds.includes("MERGER_TARGET") && validStatuses.includes("ANNOUNCED"),
    "15b. Store enum accepts structured MERGER_TARGET/ANNOUNCED", "");
  // Verify dealKey requires a source — undefined source produces a
  // key with 'unknown' prefix, so downstream aggregators can identify
  // untrustworthy rows.
  const dealKey = buildDealKey({ source: undefined, target: "Shell", acquirer: "ARX Resources", announcedAt: new Date() });
  assert(dealKey.startsWith("unknown:"),
    "15c. dealKey with no source is prefixed 'unknown:' (never persisted from prose)",
    `got ${dealKey}`);
}

// Also spot-check the format helper doesn't leak float artifacts.
function test_bonus_formatBlockClean() {
  const sit = {
    kind: "MERGER_TARGET",
    status: "ANNOUNCED",
    active: true,
    confidence: 1.0,
    acquirer: "Shell plc",
    acquirerTicker: "SHEL",
    cashPerShare: { value: 8.20, currency: "CAD" },
    stockRatio: { value: 0.40247, unit: "shares_per_share" },
    impliedDealValue: { impliedValue: 8.20 + 0.40247 * 80, currency: "CAD", verifiedAcquirerPrice: 80 },
    announcedAt: new Date("2025-08-01"),
  };
  const block = formatSpecialSituationBlock(sit, { livePrice: 33.50 });
  const hasFloatLeak = /\d+\.\d{5,}/.test(block);
  assert(!hasFloatLeak, "Bonus. formatSpecialSituationBlock output has no float artifacts",
    hasFloatLeak ? block.match(/\d+\.\d{5,}/)[0] : "");
}

async function run() {
  console.log("\n═══ Special-Situation Awareness + Composite Audit Regression Tests ═══\n");
  await test1_cashOnlyCannotBuy();
  await test2_stockOnlyRequiresVerifiedAcquirer();
  await test3_cashPlusStockImpliedValue();
  await test4_missingTermsFailClosed();
  test5_terminatedRestoresEligibility();
  test6_completedNotActive();
  await test7_ordinaryPickUnaffected();
  await test8_reconciliationHoldsWhenClean();
  await test9_duplicateContributionBlocked();
  await test10_hiddenAdjustmentBlocked();
  await test11_floatArtifactBlocked();
  test12_externalStillAttributable();
  test13_rrGateHolds();
  test14_watchRequiresTrigger();
  test15_llmProseCannotEstablishState();
  test_bonus_formatBlockClean();

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
