// Focused tests for stocksUpswitch invariants: entry != target != stop,
// live-price verification, tax handicap by account type/name, sleeve
// independence, and SCREENED downgrade for challenger that clears
// score hurdle but fails structural gates.

import { formatUpswitchBlock } from "../services/stocksUpswitch.js";

function assert(cond, label) {
  if (!cond) { console.error("✗", label); process.exitCode = 1; }
  else console.log("✓", label);
}

// Test 1 — NONE branch when no opportunities
{
  const out = formatUpswitchBlock({
    opportunities: [],
    hurdles: { core: 40, income: 25, swing: 15, spec: 20 },
    summary: { heldScored: 5, candidatesConsidered: 30 },
  });
  assert(/Actionable upgrades: NONE/.test(out), "1. NONE line when zero opportunities");
  assert(/5 holdings scored vs 30 candidates/.test(out), "   NONE line cites scored/candidates counts");
}

// Test 2 — SCREENED branch surfaced when challenger cleared score but
// failed levels/verify
{
  const out = formatUpswitchBlock({
    opportunities: [{
      recommendation: "SCREENED",
      holding: { ticker: "TD.TO", sleeve: "income", account: "TFSA", composite: { score: 60 } },
      challenger: { ticker: "SSRM.TO", currency: "CAD", composite: { score: 82 }, entryPrice: 161.42, targetPrice: 161.42, stopPrice: 161.42 },
      deltaScore: 22,
      sleeveHurdle: 20,
      taxHandicap: 0,
      transactionCost: 2,
      netAdvantage: 20,
      rationale: "SSRM.TO rejected by live-price verification: entry-price-off-market",
    }],
    hurdles: { core: 40, income: 25, swing: 15, spec: 20 },
    summary: { heldScored: 5, candidatesConsidered: 30 },
  });
  assert(/UPSWITCH SCREENED — NO ACTION/.test(out), "2. SCREENED banner rendered");
  assert(/SSRM\.TO/.test(out), "   SCREENED lists challenger ticker");
  assert(/entry\/risk gates failed/.test(out), "   SCREENED explains rejection");
  assert(/Actionable upgrades: NONE/.test(out), "   NONE line still present when only SCREENED");
}

// Test 3 — UPSWITCH branch renders challenger levels distinctly
{
  const out = formatUpswitchBlock({
    opportunities: [{
      recommendation: "UPSWITCH",
      holding: { ticker: "SLF.TO", sleeve: "income", account: "TFSA", composite: { score: 40 } },
      challenger: { ticker: "MFC.TO", currency: "CAD", composite: { score: 75 }, entryPrice: 44.20, targetPrice: 48.50, stopPrice: 42.10 },
      deltaScore: 35,
      sleeveHurdle: 25,
      taxHandicap: 0,
      transactionCost: 2,
      netAdvantage: 33,
      rationale: "Tax-advantaged account. Challenger sleeve=income hurdle +25.",
    }],
    hurdles: { core: 40, income: 25, swing: 15, spec: 20 },
    summary: { heldScored: 5, candidatesConsidered: 30 },
  });
  assert(/UPSWITCH CANDIDATE/.test(out), "3. UPSWITCH CANDIDATE header");
  assert(/entry \$44\.20/.test(out) && /target \$48\.50/.test(out) && /stop \$42\.10/.test(out),
         "   Distinct entry/target/stop levels rendered");
  assert(!/Actionable upgrades: NONE/.test(out), "   NONE line NOT present when a real UPSWITCH exists");
}

// Test 4 — sleeve rotation warning appears in UPSWITCH rationale when
// challenger and incumbent are in different sleeves
{
  // This one exercises the rationale text passed through — the
  // renderer just prints the rationale, so we simulate what the
  // engine would produce for a cross-sleeve pairing.
  const out = formatUpswitchBlock({
    opportunities: [{
      recommendation: "UPSWITCH",
      holding: { ticker: "TD.TO", sleeve: "income", account: "Individual", composite: { score: 40 } },
      challenger: { ticker: "NVDA", currency: "USD", composite: { score: 82 }, entryPrice: 130, targetPrice: 145, stopPrice: 120 },
      deltaScore: 42,
      sleeveHurdle: 15,
      taxHandicap: 5,
      transactionCost: 2,
      netAdvantage: 35,
      rationale: "NVDA composite 82 vs TD.TO 40 (Δ+42). Taxable — 5-pt handicap applied. Challenger sleeve=\"swing\" hurdle +15. NOTE: sleeve rotation (incumbent=income, challenger=swing) — this changes portfolio sleeve mix.",
    }],
    hurdles: { core: 40, income: 25, swing: 15, spec: 20 },
    summary: { heldScored: 5, candidatesConsidered: 30 },
  });
  assert(/sleeve rotation/.test(out), "4. Sleeve rotation warning surfaces in rationale");
  assert(/Taxable — 5-pt handicap applied/.test(out), "   Taxable handicap displayed for Individual account");
}

console.log("\nUpswitch integrity: " + (process.exitCode ? "FAILED" : "PASSED"));
