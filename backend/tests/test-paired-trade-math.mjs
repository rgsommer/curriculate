#!/usr/bin/env node
// test-paired-trade-math.mjs
//
// P0A.2 regression tests for the paired-trade math validator + the
// currency-unit fix in pickDefaultTicket.
//
// The 2026-08 DJT case: paired SELL raised $2,111 USD, paired BUY was
// sized at $2,278 USD in an account with $500 USD reserve cash. The
// bucket check (proceeds + starting cash ≥ cost) passed with $611 to
// spare, but the paired trade itself violated its semantics — a paired
// REDEPLOY must be funded by the SELL, not by drawing on reserve cash.
// Root cause: pickDefaultTicket at stocksDailyBriefing.js:1726 was
// interpreting `targetCad` as a native-currency budget when the caller
// passed a CAD-converted number alongside deployCurrency="USD". Result:
// the "USD" ticker got sized off the CAD number, oversizing the BUY by
// the FX factor (~1.37×).
//
// Tests cover:
//   1. Paired BUY exceeding SELL proceeds → validator rejects
//   2. Paired BUY exactly matching SELL proceeds → validator accepts
//   3. Unpaired BUYs (no SELL in bucket) → validator ignores
//   4. Multiple BUYs, one oversized → rejects the largest
//   5. Cross-currency: SELL USD + BUY CAD in same account → not paired
//   6. pickDefaultTicket sizing math: USD-priced ticker + USD budget →
//      correct share count (no 1.37× inflation)

import { validateRecs, buildValidatorContext } from "../services/stocksRecValidator.js";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// Verified live prices for all fixture tickers. Every BUY must trace
// to a "verified" live price with a price within the drift threshold
// of the rec's entryPrice or ruleMarketDataProvenance / ruleLivePriceDrift
// short-circuits before the batch-phase paired-trade-math rule runs.
const LIVE_PRICES = {
  VOO:         { price: 455.60, currency: "USD", provenance: "verified", sources: ["yahoo", "fmp"], confidence: "high" },
  "SMALL-BUY": { price: 200,    currency: "USD", provenance: "verified", sources: ["yahoo", "fmp"], confidence: "high" },
  "BIG-BUY":   { price: 300,    currency: "USD", provenance: "verified", sources: ["yahoo", "fmp"], confidence: "high" },
  "CAD-BUY":   { price: 100,    currency: "CAD", provenance: "verified", sources: ["yahoo", "fmp"], confidence: "high" },
};

const baseCtx = () => buildValidatorContext({
  positions: [],
  cashAccounts: [],
  fxUsdCad: 1.37,
  sleeveTargets: { core: 60, swing: 20, income: 15, spec: 5 },
  computeSleeveBalance: null,
  sectorRotation: null,
  tradingRegime: { regime: "RISK_ON" },
  sectorHardAvoid: [],
  livePrices: LIVE_PRICES,
  userExpectancy: null,
  liquidity: null,
});

// Common fields a BUY rec needs to pass per-rec phase so the batch
// paired-trade-math rule can run against it. _sleeveAutoFilled skips
// the classifier cross-check for synthetic test tickers.
const buyDefaults = (over = {}) => ({
  sleeve: "core",
  _sleeveAutoFilled: true,
  horizonDays: 30,
  ...over,
});

// ─── 1. Paired BUY exceeds SELL proceeds → REJECT ──────────────────
function test1_pairedBuyExceedsProceeds() {
  const recs = [
    {
      ticker: "DJT-SELL", action: "SELL",
      shares: 100, entryPrice: 21.11,        // proceeds $2,111 USD
      account: "Non-Spousal USD", entryCurrency: "USD",
      sleeve: "spec",
    },
    buyDefaults({
      ticker: "VOO", action: "BUY",
      shares: 5, entryPrice: 455.60,          // cost $2,278 USD
      account: "Non-Spousal USD", entryCurrency: "USD",
    }),
  ];
  const { rejected } = validateRecs(recs, baseCtx());
  const voo = rejected.find(r => r.rec.ticker === "VOO");
  assert(voo, "1. VOO rejected when BUY $2278 > SELL proceeds $2111");
  const reasons = voo?.rejections?.map(r => r.reason) || [];
  assert(reasons.includes("paired-trade-math"),
    "1b. Rejection reason includes paired-trade-math",
    `got: ${reasons.join(", ")}`);
}

// ─── 2. Paired BUY within SELL proceeds → ACCEPT ────────────────────
function test2_pairedBuyFits() {
  const recs = [
    {
      ticker: "DJT-SELL", action: "SELL",
      shares: 100, entryPrice: 21.11,        // proceeds $2,111
      account: "Non-Spousal USD", entryCurrency: "USD",
      sleeve: "spec",
    },
    buyDefaults({
      ticker: "VOO", action: "BUY",
      shares: 4, entryPrice: 455.60,          // cost $1,822 — fits inside proceeds
      account: "Non-Spousal USD", entryCurrency: "USD",
    }),
  ];
  const { accepted, rejected } = validateRecs(recs, baseCtx());
  const vooAccepted = accepted.some(r => r.ticker === "VOO");
  const vooRejectedForMath = rejected
    .filter(r => r.rec.ticker === "VOO")
    .some(r => (r.rejections || []).some(rr => rr.reason === "paired-trade-math"));
  assert(vooAccepted || !vooRejectedForMath,
    "2. VOO accepted (or at least not paired-trade-math-rejected) when BUY $1822 ≤ SELL proceeds $2111",
    `accepted=${vooAccepted} rejectedForMath=${vooRejectedForMath}`);
}

// ─── 3. Unpaired BUY (no SELL in bucket) → not evaluated ───────────
function test3_unpairedBuyIgnored() {
  const recs = [
    buyDefaults({
      ticker: "VOO", action: "BUY",
      shares: 10, entryPrice: 455.60,
      account: "Non-Spousal USD", entryCurrency: "USD",
    }),
  ];
  const { rejected } = validateRecs(recs, baseCtx());
  const mathReject = rejected
    .filter(r => r.rec.ticker === "VOO")
    .some(r => (r.rejections || []).some(rr => rr.reason === "paired-trade-math"));
  assert(!mathReject,
    "3. Unpaired BUY not evaluated by paired-trade-math rule");
}

// ─── 4. Multiple BUYs, one oversized → largest rejected ─────────────
function test4_largestOffenderRejected() {
  const recs = [
    {
      ticker: "SELL-A", action: "SELL",
      shares: 100, entryPrice: 20,            // proceeds $2,000
      account: "Non-Spousal USD", entryCurrency: "USD",
      sleeve: "spec",
    },
    buyDefaults({
      ticker: "SMALL-BUY", action: "BUY",
      shares: 1, entryPrice: 200,             // cost $200
      account: "Non-Spousal USD", entryCurrency: "USD",
    }),
    buyDefaults({
      ticker: "BIG-BUY", action: "BUY",
      shares: 10, entryPrice: 300,            // cost $3,000 — this is the offender
      account: "Non-Spousal USD", entryCurrency: "USD",
    }),
  ];
  const { rejected } = validateRecs(recs, baseCtx());
  const bigMath = rejected
    .filter(r => r.rec.ticker === "BIG-BUY")
    .some(r => (r.rejections || []).some(rr => rr.reason === "paired-trade-math"));
  const smallMath = rejected
    .filter(r => r.rec.ticker === "SMALL-BUY")
    .some(r => (r.rejections || []).some(rr => rr.reason === "paired-trade-math"));
  assert(bigMath, "4. Largest BUY rejected first when bucket overshoots");
  assert(!smallMath,
    "4b. Small BUY that fits inside remaining proceeds not rejected",
    "small BUY should survive largest-first rejection");
}

// ─── 5. Cross-currency same account → not paired ────────────────────
function test5_crossCurrencyNotPaired() {
  const recs = [
    {
      ticker: "USD-SELL", action: "SELL",
      shares: 100, entryPrice: 20,
      account: "Dual-CCY Account", entryCurrency: "USD",
      sleeve: "spec",
    },
    buyDefaults({
      ticker: "CAD-BUY", action: "BUY",
      shares: 100, entryPrice: 100,            // $10,000 CAD, no CAD proceeds paired
      account: "Dual-CCY Account", entryCurrency: "CAD",
    }),
  ];
  const { rejected } = validateRecs(recs, baseCtx());
  const cadMath = rejected
    .filter(r => r.rec.ticker === "CAD-BUY")
    .some(r => (r.rejections || []).some(rr => rr.reason === "paired-trade-math"));
  assert(!cadMath,
    "5. USD SELL + CAD BUY in same account not evaluated by paired-trade-math (no cross-currency pairing)");
}

// ─── 6. pickDefaultTicket sizing math ───────────────────────────────
// We can't easily import the inner arrow function, so read the source
// and assert on the current-state signature. The key invariant is that
// after the P0A.2 rename, the function no longer has a `targetCad`
// parameter and no longer contains the buggy conversion branches.
async function test6_pickDefaultTicketSourceInvariant() {
  const fs = await import("fs");
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  const declMatch = src.match(/const pickDefaultTicket = \(list, (\w+), deployCurrency\)/);
  assert(declMatch && declMatch[1] === "targetNative",
    "6. pickDefaultTicket parameter renamed targetCad → targetNative",
    `got param name: ${declMatch?.[1] ?? "(not found)"}`);
  assert(!src.includes("budgetInNative = targetCad * fx"),
    "6b. Buggy CAD→USD conversion branch removed");
  assert(!src.includes("budgetInNative = targetCad / fx"),
    "6c. Buggy USD→CAD conversion branch removed");
  // Confirm the caller sites now pass native amounts.
  assert(src.includes("pickDefaultTicket(destList, proceedsNative, r.currency)"),
    "6d. Trail-stop IF-EXIT REDEPLOY passes proceedsNative (not proceedsCad)");
  assert(src.includes("pickDefaultTicket(coreList, proceeds, r.currency)"),
    "6e. Confirmed-stop CORE DEPLOY passes native proceeds");
  assert(src.includes("pickDefaultTicket(list, deployNative, pool.ccy)"),
    "6f. Cash-deploy pool passes deployNative (not deployCadThisPool)");
}

// ─── 7. Mandate rec persistence maps sizeShares → shares ────────────
async function test7_mandatePersistMapsSizeShares() {
  const fs = await import("fs");
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/shares:\s*r\.sizeShares/.test(src),
    "7. Persistence of mandate recs maps r.sizeShares → shares (was null before P0A.2)");
}

async function run() {
  console.log("\n═══ Paired-Trade Math + Currency-Unit Regression (P0A.2) ═══\n");
  test1_pairedBuyExceedsProceeds();
  test2_pairedBuyFits();
  test3_unpairedBuyIgnored();
  test4_largestOffenderRejected();
  test5_crossCurrencyNotPaired();
  await test6_pickDefaultTicketSourceInvariant();
  await test7_mandatePersistMapsSizeShares();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(2); });
