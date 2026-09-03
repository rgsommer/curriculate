// Regression tests for the previous-day recap service (2026-09-02).
// Verifies:
//   • Format helper produces the expected block structure
//   • Signed pct + dollar formatters render sensibly
//   • Reason-attribution prefers 8-K over benchmark-relative
//   • Null-safe on missing portfolio / benchmark / moves
//   • AI-call timeout constant + web_search cap wired

import { formatPreviousDayRecap } from "../services/stocksPreviousDayRecap.js";
import fs from "fs";

let passed = 0, failed = 0;
const results = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; results.push({ name, status: "PASS" }); console.log("  ✓", name); }
  else { failed++; results.push({ name, status: "FAIL", detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

function test1_headerRendered() {
  const md = formatPreviousDayRecap({
    portfolio: { yesterdayDate: "2026-09-01", deltaCad: 1234, deltaPct: 0.5 },
    benchmarks: { SPY: 0.4, "XIC.TO": 0.2 },
    gainers: [], losers: [], recTransitions: [], eightKs: [], moves: [],
  });
  assert(md.includes("## 📊 Yesterday's tape"),
    "1. Recap block starts with §📊 Yesterday's tape header", "");
  assert(md.includes("Portfolio 2026-09-01"),
    "1b. Includes yesterday's date + portfolio headline", "");
  assert(md.includes("SPY +0.4%"),
    "1c. Includes SPY benchmark context", "");
}

function test2_signedPctFormatted() {
  const md = formatPreviousDayRecap({
    portfolio: { yesterdayDate: "2026-09-01", deltaCad: -5000, deltaPct: -1.8 },
    benchmarks: { SPY: -1.5 },
    gainers: [], losers: [], recTransitions: [], eightKs: [], moves: [],
  });
  assert(md.includes("−$5,000") || md.includes("−$5000"),
    "2. Negative dollar renders with minus sign", "");
  assert(md.includes("-1.8%") || md.includes("−1.8%") || md.includes("(-1.8"),
    "2b. Negative pct renders", md.slice(0, 300));
}

function test3_gainersLosersRendered() {
  const md = formatPreviousDayRecap({
    portfolio: null,
    benchmarks: { SPY: 0.5 },
    gainers: [{ ticker: "NVDA", returnPct: 3.2, dailyPnl: 200, currency: "USD" }],
    losers: [{ ticker: "SU.TO", returnPct: -2.5, dailyPnl: -180, currency: "CAD" }],
    recTransitions: [], eightKs: [], moves: [
      { ticker: "NVDA", returnPct: 3.2 },
      { ticker: "SU.TO", returnPct: -2.5 },
    ],
  });
  assert(md.includes("**Top movers up**"), "3. Top movers up section rendered", "");
  assert(md.includes("**NVDA**"), "3b. Gainer ticker in bold", "");
  assert(md.includes("**Top movers down**"), "3c. Top movers down section rendered", "");
  assert(md.includes("**SU.TO**"), "3d. Loser ticker in bold", "");
}

function test4_reasonPrefers8k() {
  const md = formatPreviousDayRecap({
    portfolio: null,
    benchmarks: { SPY: 0.5 },
    gainers: [{ ticker: "ARX.TO", returnPct: 12.4, dailyPnl: 300, currency: "CAD" }],
    losers: [], recTransitions: [],
    eightKs: [{ ticker: "ARX", itemNumbers: ["1.01"], itemLabels: ["Material Definitive Agreement"], filedAt: new Date() }],
    moves: [{ ticker: "ARX.TO", returnPct: 12.4 }],
  });
  assert(/8-K filed/i.test(md),
    "4. 8-K reason wins over benchmark-relative attribution", md.slice(0, 400));
  assert(md.includes("Material Definitive Agreement"),
    "4b. Item label surfaces in the reason", "");
}

function test5_marketRelativeReason() {
  const md = formatPreviousDayRecap({
    portfolio: null,
    benchmarks: { SPY: 0.5 },
    gainers: [{ ticker: "AAPL", returnPct: 2.5, dailyPnl: 200, currency: "USD" }],
    losers: [], recTransitions: [], eightKs: [],
    moves: [{ ticker: "AAPL", returnPct: 2.5 }],
  });
  assert(/outperformed market by/i.test(md),
    "5. Positive vs benchmark → outperformed reason", md.slice(0, 400));
}

function test6_recTransitionsRendered() {
  const md = formatPreviousDayRecap({
    portfolio: null, benchmarks: {},
    gainers: [], losers: [], eightKs: [], moves: [],
    recTransitions: [
      { ticker: "TSLA", action: "BUY", status: "target-hit", hitPrice: 300, lastPnlPct: 15 },
      { ticker: "AMD", action: "BUY", status: "stop-hit", hitPrice: 140, lastPnlPct: -8 },
    ],
  });
  assert(md.includes("**Rec events (last 24h)**"), "6. Rec events section header", "");
  assert(md.includes("🎯 target hit"), "6b. Target-hit emoji + label", "");
  assert(md.includes("🛑 stop hit"), "6c. Stop-hit emoji + label", "");
  assert(md.includes("**TSLA**") && md.includes("**AMD**"), "6d. Both tickers rendered", "");
}

function test7_emptyRecapDoesntBlow() {
  const md = formatPreviousDayRecap({
    portfolio: null, benchmarks: {},
    gainers: [], losers: [], recTransitions: [], eightKs: [], moves: [],
  });
  assert(typeof md === "string" && md.includes("Yesterday's tape"),
    "7. Empty recap still renders the header (no crash)", "");
  assert(md.includes("Insufficient snapshot history"),
    "7b. Missing portfolio surfaces friendly message", "");
}

function test8_nullRecapReturnsEmpty() {
  const md = formatPreviousDayRecap(null);
  assert(md === "", "8. Null recap returns empty string (renderer no-ops safely)", `got ${JSON.stringify(md)}`);
}

// ─── AI-call hardening ────────────────────────────────────────────
function test9_aiCallHasAbortController() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/new AbortController\(\)/.test(src),
    "9. callClaude wraps fetch with AbortController for per-call timeout", "");
  assert(/CALL_TIMEOUT_MS/.test(src),
    "9b. CALL_TIMEOUT_MS constant defined", "");
  assert(/STOCKS_ADVICE_CALL_TIMEOUT_MS/.test(src),
    "9c. Env override STOCKS_ADVICE_CALL_TIMEOUT_MS available", "");
}

function test10_webSearchReduced() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  const m = src.match(/STOCKS_ADVICE_MAX_SEARCHES,\s*10\)\s*\|\|\s*(\d+)/);
  const val = m ? Number(m[1]) : null;
  assert(val === 3,
    "10. web_search max_uses default reduced 8 → 3 (bounded wall-clock)",
    `got ${val}`);
}

function test11_briefingWiresRecap() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/jobs/stocksDailyBriefing.js",
    "utf-8"
  );
  assert(/buildPreviousDayRecap/.test(src),
    "11. generateBriefing calls buildPreviousDayRecap", "");
  assert(/formatPreviousDayRecap/.test(src),
    "11b. Renders via formatPreviousDayRecap", "");
  assert(/setTimeout\(\(\)\s*=>\s*resolve\(null\),\s*8_000\)/.test(src),
    "11c. Recap wrapped in 8s timeout so a slow Yahoo can't stall briefing", "");
}

async function run() {
  console.log("\n═══ Previous-Day Recap + AI Hardening Regression Tests ═══\n");
  test1_headerRendered();
  test2_signedPctFormatted();
  test3_gainersLosersRendered();
  test4_reasonPrefers8k();
  test5_marketRelativeReason();
  test6_recTransitionsRendered();
  test7_emptyRecapDoesntBlow();
  test8_nullRecapReturnsEmpty();
  test9_aiCallHasAbortController();
  test10_webSearchReduced();
  test11_briefingWiresRecap();

  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const r of results.filter(x => x.status === "FAIL")) {
      console.log(`  • ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

run();
