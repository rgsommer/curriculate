// backend/services/stocksBenchmarkMatched.js
//
// P3 (2026-09-09) — matched-period benchmark helpers.
// Every question of the form "did our stock beat the correct
// benchmark over exactly the period we held it?" routes through here.
//
// Benchmark assignment (deterministic, spec §2):
//   • .TO / .V / .NE / .CN suffix  → XIC.TO (S&P/TSX Composite)
//   • Explicit CAD currency        → XIC.TO
//   • Everything else              → SPY (S&P 500)
//   • "core-etf" sleeve override   → XEQT.TO for CAD investor
//     (only used when the caller flags a global-equity CORE holding)
//
// Public API:
//   pickBenchmarkFor({ ticker, currency, sleeve? }) → "SPY" | "XIC.TO" | "XEQT.TO"
//   getMatchedReturnPct({ ticker, fromDate, toDate }) → { pct, note }
//   getMatchedAlphaPct({ securityReturnPct, benchmarkReturnPct }) → number

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

export function pickBenchmarkFor({ ticker, currency, sleeve } = {}) {
  const t = String(ticker || "").toUpperCase();
  const isCad = /\.(TO|V|NE|CN)$/i.test(t) || String(currency || "").toUpperCase() === "CAD";
  if (String(sleeve || "").toLowerCase() === "core-global") return "XEQT.TO";
  return isCad ? "XIC.TO" : "SPY";
}

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// Return the pct change of `bars` from the first bar with date ≥ fromYmd
// to the last bar with date ≤ toYmd. Null if either endpoint absent.
function returnBetween(bars, fromYmd, toYmd) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  let a = null, b = null;
  for (const bar of bars) {
    const d = ymd(bar.date);
    if (d >= fromYmd && a == null) a = bar;
    if (d <= toYmd) b = bar; else break;
  }
  if (!a || !b || !(a.close > 0) || !(b.close > 0)) return null;
  return ((b.close - a.close) / a.close) * 100;
}

// PUBLIC — matched-period return for any ticker over [from, to].
// `bars` may be pre-fetched and injected via ctx (test-friendly).
export async function getMatchedReturnPct({ ticker, fromDate, toDate, bars = null }) {
  if (!ticker || !fromDate || !toDate) return { pct: null, note: "missing input" };
  const fromYmd = ymd(fromDate);
  const toYmd = ymd(toDate);
  if (fromYmd > toYmd) return { pct: null, note: "from > to" };
  const yb = bars || await fetchYahooDaily(ticker, "2y").catch(() => null);
  if (!Array.isArray(yb) || yb.length === 0) return { pct: null, note: "bench-bars-unavailable" };
  const pct = returnBetween(yb, fromYmd, toYmd);
  if (pct == null) return { pct: null, note: "no matching bars in window" };
  return { pct, note: null };
}

export function getMatchedAlphaPct({ securityReturnPct, benchmarkReturnPct }) {
  if (!Number.isFinite(securityReturnPct) || !Number.isFinite(benchmarkReturnPct)) return null;
  return securityReturnPct - benchmarkReturnPct;
}
