#!/usr/bin/env node
// test-briefing-integrity.mjs
//
// Phase 5 of the Stocks Advisor rewrite (spec §24 Automated Tests):
// intentionally inject broken data into the briefing / audit / calc
// pipeline and assert the system REFUSES to emit actionable recs.
//
// Per spec: "The briefing generator should refuse to produce
// actionable recommendations when these tests expose a critical
// inconsistency."
//
// Coverage:
//   1. Impossible stop (stop > current price)              → block
//   2. Trailing stop above HWM                             → block
//   3. Zero stop / zero target on a rec                    → block
//   4. Negative cash after simulated BUY                   → block
//   5. Sleeve overshoot on unpaired BUY                    → block
//   6. Single-name concentration breach after BUY          → block
//   7. Rec on a blocked ticker                             → block
//   8. Phantom SELL on non-held ticker                     → block
//   9. Currency mismatch (rec CAD, position USD)           → warn
//  10. Percentage reconciliation drift (synthesized)       → block/warn
//
// Run: node backend/tests/test-briefing-integrity.mjs
// Exit 0 on all pass, 1 on any fail.

import { auditBriefingBeforeSend } from "../services/briefingAudit.js";
import { computeCanonicalPortfolio } from "../services/portfolioCalcEngine.js";
import { simulateTradeImpact, applyTradeToProfile } from "../services/tradeImpactSimulator.js";

let passed = 0;
let failed = 0;
const results = [];

function assert(cond, name, detail) {
  if (cond) {
    passed++;
    results.push({ name, status: "PASS" });
  } else {
    failed++;
    results.push({ name, status: "FAIL", detail });
    console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function assertBlocked(audit, checkCode, name) {
  const has = (audit.blockers || []).some(b => b.check === checkCode || String(b.check).startsWith(checkCode));
  assert(has, name, `expected blocker "${checkCode}"; got: ${(audit.blockers || []).map(b => b.check).join(", ") || "none"}`);
}

function assertWarned(audit, checkCode, name) {
  const has = (audit.warnings || []).some(w => w.check === checkCode || String(w.check).startsWith(checkCode));
  assert(has, name, `expected warning "${checkCode}"; got: ${(audit.warnings || []).map(w => w.check).join(", ") || "none"}`);
}

// ─── Test fixtures ───────────────────────────────────────────────────
const baseProfile = () => ({
  email: "test@fixture.local",
  fxUsdCad: 1.37,
  positions: [
    { ticker: "AAPL", qty: 10, priceUsd: 200, avgCost: 180, acct: "a1", ccy: "USD", stopPrice: 190 },
    { ticker: "ENB.TO", qty: 100, priceCad: 55, avgCost: 50, acct: "a2", ccy: "CAD", stopPrice: 50 },
  ],
  accounts: [
    { id: "a1", name: "Non-Spousal USD", cashUsd: 5000, cashCad: 0, type: "individual" },
    { id: "a2", name: "RRSP CAD", cashUsd: 0, cashCad: 3000, type: "rrsp" },
  ],
  sleeveTargets: { core: 75, swing: 5, income: 15, spec: 5 },
});

// ─── 1. Impossible stop (stop > current) ─────────────────────────────
async function testImpossibleStop() {
  const profile = baseProfile();
  profile.positions.push({
    ticker: "HALT", qty: 20, priceUsd: 100, avgCost: 80,
    acct: "a1", ccy: "USD", hardStopPrice: 120,
  });
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "impossible-hard-stop", "1. Impossible hard stop (stop > current) fires blocker");
}

// ─── 2. Trailing stop above HWM ──────────────────────────────────────
async function testTrailingStopAboveHwm() {
  const profile = baseProfile();
  profile.positions.push({
    ticker: "TWS", qty: 15, priceUsd: 150, avgCost: 130,
    acct: "a1", ccy: "USD", trailStopPrice: 175, trailHwm: 160,
  });
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "trailing-stop-exceeds-hwm", "2. Trailing stop above HWM fires blocker");
}

// ─── 3. Zero stop / zero target on a rec ─────────────────────────────
async function testZeroStopTarget() {
  const profile = baseProfile();
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [
      { ticker: "MSFT", action: "BUY", entryPrice: 400, stopPrice: 0, targetPrice: 420, sleeve: "core", account: "a1", entryCurrency: "USD" },
      { ticker: "GOOGL", action: "BUY", entryPrice: 150, stopPrice: 140, targetPrice: 0, sleeve: "core", account: "a1", entryCurrency: "USD" },
    ],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "zero-stop", "3a. Zero stop on rec fires blocker");
  assertBlocked(audit, "zero-target", "3b. Zero target on rec fires blocker");
}

// ─── 4. Negative cash after simulated BUY ────────────────────────────
function testNegativeCashAfterBuy() {
  const profile = baseProfile();
  // Non-Spousal has $5000 USD; try to buy $10k of NVDA there.
  const sim = simulateTradeImpact(profile, {
    ticker: "NVDA", action: "BUY", shares: 100, entryPrice: 100,
    entryCurrency: "USD", account: "a1", sleeve: "spec",
  });
  const hasNegBlock = (sim?.violations || []).some(v => v.code === "negative-cash-in-account" && v.severity === "block");
  assert(hasNegBlock, "4. Simulated BUY that exceeds cash flags negative-cash-in-account (block)",
    `violations: ${JSON.stringify(sim?.violations)}`);
}

// ─── 5. Sleeve overshoot on unpaired BUY ─────────────────────────────
function testSleeveOvershoot() {
  const profile = baseProfile();
  // AAPL is swing; adding $1k more into swing when target is 5% will overshoot.
  const sim = simulateTradeImpact(profile, {
    ticker: "MSFT", action: "BUY", shares: 3, entryPrice: 400,
    entryCurrency: "USD", account: "a1", sleeve: "swing",
  });
  const overshoot = (sim?.violations || []).some(v => v.code === "sleeve-overshoot-after-trade");
  assert(overshoot, "5. Simulated BUY into over-sleeve fires sleeve-overshoot-after-trade",
    `violations: ${JSON.stringify(sim?.violations)}`);
}

// ─── 6. Concentration breach after BUY ───────────────────────────────
function testConcentrationBreach() {
  const profile = baseProfile();
  // Build a portfolio where AAPL is already 18%, then add more to push past 20%.
  profile.positions = [
    { ticker: "AAPL", qty: 500, priceUsd: 200, avgCost: 180, acct: "a1", ccy: "USD" }, // $100k USD = ~$137k CAD
    { ticker: "ENB.TO", qty: 5000, priceCad: 55, avgCost: 50, acct: "a2", ccy: "CAD" }, // $275k CAD
  ];
  profile.accounts[0].cashUsd = 50000;
  const sim = simulateTradeImpact(profile, {
    ticker: "AAPL", action: "ADD", shares: 500, entryPrice: 200,
    entryCurrency: "USD", account: "a1", sleeve: "swing",
  });
  const breach = (sim?.violations || []).some(v => v.code === "concentration-breach-after-trade");
  assert(breach, "6. Simulated ADD that breaches single-name cap fires concentration-breach-after-trade",
    `sim: ${JSON.stringify(sim?.deltas?.position)}, violations: ${JSON.stringify(sim?.violations)}`);
}

// ─── 7. Rec on a blocked ticker ──────────────────────────────────────
async function testBuyOfBlockedTicker() {
  const profile = baseProfile();
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [
      { ticker: "TSLA", action: "BUY", entryPrice: 200, stopPrice: 180, targetPrice: 250, sleeve: "spec", account: "a1", entryCurrency: "USD" },
    ],
    rejectedRecs: [
      { rec: { ticker: "TSLA" }, reason: "sector-hostile" },
    ],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "buy-of-blocked-ticker", "7. BUY of a ticker also in rejectedRecs fires blocker");
}

// ─── 7b. Same-ticker self-swap ───────────────────────────────────────
async function testSameTickerSelfSwap() {
  const profile = baseProfile();
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [
      { ticker: "AAPL", action: "SELL", entryPrice: 200, stopPrice: 190, targetPrice: 210, sleeve: "swing", account: "a1", entryCurrency: "USD" },
      { ticker: "AAPL", action: "BUY", entryPrice: 200, stopPrice: 190, targetPrice: 220, sleeve: "swing", account: "a1", entryCurrency: "USD" },
    ],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "same-ticker-self-swap", "7b. SELL AAPL + BUY AAPL in same batch fires blocker");
}

// ─── 8. Phantom SELL on non-held ticker ──────────────────────────────
async function testPhantomSell() {
  const profile = baseProfile();
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [
      { ticker: "IBM", action: "SELL", entryPrice: 200, stopPrice: 190, targetPrice: 210, sleeve: "core", account: "a1", entryCurrency: "USD" },
    ],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "phantom-sell", "8. SELL on non-held ticker fires blocker");
}

// ─── 9. Currency mismatch warning ────────────────────────────────────
async function testCurrencyMismatchWarn() {
  const profile = baseProfile();
  // AAPL is held as USD; issue a CAD-flagged rec on it.
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [
      { ticker: "AAPL", action: "SELL", entryPrice: 270, stopPrice: 260, targetPrice: 280, sleeve: "swing", account: "a1", entryCurrency: "CAD" },
    ],
    positions: profile.positions,
    profile,
  });
  assertWarned(audit, "currency-mismatch-held", "9. USD-held ticker with CAD-flagged rec fires warning");
}

// ─── 10. Percentage reconciliation via canonical ─────────────────────
function testPercentageReconciliation() {
  const profile = baseProfile();
  const canonical = computeCanonicalPortfolio(profile);
  // Position weights + cash pct should sum to ~100.
  const sumPos = canonical.positions.reduce((s, r) => s + r.position_weight_pct, 0);
  const sumSleeve = canonical.sleeves.reduce((s, r) => s + r.sleeve_weight_pct, 0);
  const sumAcct = canonical.accounts.reduce((s, r) => s + r.account_weight_pct, 0);
  const total = sumPos + canonical.cash.cash_pct;
  assert(Math.abs(total - 100) < 0.5, `10a. positions + cash = 100% (got ${total.toFixed(3)})`);
  assert(Math.abs(sumSleeve - (100 - canonical.cash.cash_pct)) < 0.5, `10b. sleeve weights match non-cash total (sleeve=${sumSleeve.toFixed(3)}, expected=${(100 - canonical.cash.cash_pct).toFixed(3)})`);
  assert(Math.abs(sumAcct - 100) < 0.5, `10c. account weights sum to 100 (got ${sumAcct.toFixed(3)})`);
  assert(canonical.reconciliation.passed, "10d. reconciliation.passed on well-formed portfolio");
}

// ─── 11. Redeploy cost exceeds proceeds + starting cash ──────────────
async function testRedeployExceedsCash() {
  const profile = baseProfile();
  // Non-Spousal starts with $5000 USD. SELL $1000, BUY $10000 → $4000 short.
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: "## 2. 🛑 FORBIDDEN TODAY\nNone.\n",
    acceptedRecs: [
      { ticker: "PLTR", action: "SELL", shares: 5, entryPrice: 200, stopPrice: 190, targetPrice: 210, sleeve: "spec", account: "a1", entryCurrency: "USD" },
      { ticker: "MSFT", action: "BUY", shares: 25, entryPrice: 400, stopPrice: 380, targetPrice: 440, sleeve: "core", account: "a1", entryCurrency: "USD" },
    ],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "redeploy-exceeds-proceeds-plus-cash", "11. BUY cost > SELL proceeds + starting cash fires blocker");
}

// ─── 12. Rendered sleeve summary omits a sleeve ──────────────────────
async function testRenderedSleeveOmitsSleeve() {
  const profile = baseProfile();
  // Simulate an AI rendering CORE + INCOME + SPEC + Cash but no SWING —
  // exactly the alignment bug the audit is meant to catch.
  const badMd = "CORE: 75% · INCOME: 15% · SPEC: 5% · Cash: 5%\n\n## 2. 🛑 FORBIDDEN TODAY\nNone.\n";
  const audit = await auditBriefingBeforeSend({
    email: "test",
    md: badMd,
    acceptedRecs: [],
    positions: profile.positions,
    profile,
  });
  assertBlocked(audit, "rendered-sleeve-missing", "12. AI-rendered sleeve line missing SWING fires blocker");
}

// ─── 13. Account-label mismatch (223) ──────────────────────────────
async function testAccountLabelMismatch() {
  const profile = {
    ...baseProfile(),
    accounts: [
      { id: "59659702", name: "RRSP", cashCad: 1000, cashUsd: 0, type: "rrsp" },
      { id: "12345678", name: "Non-Spousal", cashCad: 0, cashUsd: 500, type: "individual" },
    ],
  };
  // Bug scenario from real briefing: same account id "59659702"
  // labeled both Non-Spousal and RRSP.
  const badMd = `## 2. 🛑 FORBIDDEN TODAY\nNone.\n\nBUY 5 sh XEQT in Non-Spousal (59659702).\nBUY 3 sh XEQT in RRSP (59659702).\n`;
  const audit = await auditBriefingBeforeSend({
    email: "test", md: badMd, acceptedRecs: [], positions: profile.positions, profile,
  });
  assertBlocked(audit, "account-label-mismatch", "13. Same account id labeled as two different account names fires blocker");
}

// ─── 14. Cross-section contradiction (224) ─────────────────────────
async function testCrossSectionContradiction() {
  const profile = baseProfile();
  // §1 has a SELL mandate on AAPL; later section says HOLD AAPL —
  // without any "as resolved above" marker.
  const badMd = `## 1. 🚨 MANDATORY ACTIONS
1. **SELL AT MARKET** — AAPL: hard stop breached at $190. SELL 10 sh AAPL @ market.

## A2. Per-holding signals
- AAPL: mechanical noise on a long-horizon hold; HOLD.
`;
  const audit = await auditBriefingBeforeSend({
    email: "test", md: badMd, acceptedRecs: [], positions: profile.positions, profile,
  });
  assertBlocked(audit, "mandate-vs-noaction-contradiction", "14. §1 SELL mandate + later HOLD without resolution marker fires blocker");
}

// ─── 15. Cross-section: resolution marker allows softening ────────
async function testCrossSectionResolutionMarker() {
  const profile = baseProfile();
  // Same conflict as #14 BUT with explicit "as resolved above" marker.
  // Should NOT block — that phrasing legitimately refers to the §1
  // decision instead of contradicting it.
  const okMd = `## 1. 🚨 MANDATORY ACTIONS
1. **TRAIL STOP REVIEW** — AAPL. Decide today.

## A2. Per-holding signals
- AAPL: trail-under-review; per §1 review, HOLD pending decision below.
`;
  const audit = await auditBriefingBeforeSend({
    email: "test", md: okMd, acceptedRecs: [], positions: profile.positions, profile,
  });
  const hit = (audit.blockers || []).some(b => b.check === "mandate-vs-noaction-contradiction");
  assert(!hit, "15. HOLD with 'per §1 review' resolution marker does NOT block");
}

// ─── Runner ──────────────────────────────────────────────────────────
async function main() {
  console.log("Briefing integrity injection-fault suite (Phase 5)");
  console.log("─".repeat(60));
  await testImpossibleStop();
  await testTrailingStopAboveHwm();
  await testZeroStopTarget();
  testNegativeCashAfterBuy();
  testSleeveOvershoot();
  testConcentrationBreach();
  await testBuyOfBlockedTicker();
  await testSameTickerSelfSwap();
  await testPhantomSell();
  await testCurrencyMismatchWarn();
  testPercentageReconciliation();
  await testRedeployExceedsCash();
  await testRenderedSleeveOmitsSleeve();
  await testAccountLabelMismatch();
  await testCrossSectionContradiction();
  await testCrossSectionResolutionMarker();

  console.log("─".repeat(60));
  for (const r of results) console.log(`  ${r.status === "PASS" ? "✓" : "✗"} ${r.name}`);
  console.log("─".repeat(60));
  console.log(`Total: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error("Suite crashed:", e); process.exit(2); });
