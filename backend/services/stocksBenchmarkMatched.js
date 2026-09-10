// backend/services/stocksBenchmarkMatched.js
//
// P3 (2026-09-09) + P3.6 (2026-09-10) — matched-period benchmark helpers.
// Every question of the form "did our stock beat the correct benchmark
// over exactly the period we held it?" routes through here.
//
// P3.6 changes:
//   • Uses the resilient market-data adapter (Yahoo primary, FMP
//     fallback, DATA_UNAVAILABLE final) with full provenance.
//   • Missing data → { pct: null, status: "DATA_UNAVAILABLE" }.
//     NEVER coerced to zero — zero is a legitimate market return.
//   • Alpha becomes null when either side is null.
//
// Benchmark assignment (deterministic, spec §2):
//   • .TO / .V / .NE / .CN suffix  → XIC.TO (S&P/TSX Composite)
//   • Explicit CAD currency        → XIC.TO
//   • Everything else              → SPY (S&P 500)
//   • "core-etf" sleeve override   → XEQT.TO for CAD investor
//
// Public API:
//   pickBenchmarkFor({ ticker, currency, sleeve? }) → "SPY" | "XIC.TO" | "XEQT.TO"
//   getMatchedReturnPct({ ticker, fromDate, toDate }) →
//     { pct, status, note, marketDataSource?, fallbackUsed?,
//       actualRange?, fetchAsOf? }
//   getMatchedAlphaPct({ securityReturnPct, benchmarkReturnPct }) → number|null

import { fetchDailyBars } from "./stocksMarketDataAdapter.js";

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
    if (!d) continue;
    if (d >= fromYmd && a == null) a = bar;
    if (d <= toYmd) b = bar; else break;
  }
  if (!a || !b || !(a.close > 0) || !(b.close > 0)) return null;
  return ((b.close - a.close) / a.close) * 100;
}

// PUBLIC — matched-period return for any ticker over [from, to].
// `bars` may be pre-fetched and injected via ctx (test-friendly).
export async function getMatchedReturnPct({ ticker, fromDate, toDate, bars = null }) {
  if (!ticker || !fromDate || !toDate) {
    return { pct: null, status: "DATA_UNAVAILABLE", note: "missing-input" };
  }
  const fromYmd = ymd(fromDate);
  const toYmd = ymd(toDate);
  if (fromYmd > toYmd) return { pct: null, status: "DATA_UNAVAILABLE", note: "from-after-to" };

  // Injected bars for tests take precedence — they arrive with .date already.
  if (Array.isArray(bars)) {
    if (bars.length === 0) return { pct: null, status: "DATA_UNAVAILABLE", note: "bench-bars-empty" };
    const pct = returnBetween(bars, fromYmd, toYmd);
    if (pct == null) return { pct: null, status: "DATA_UNAVAILABLE", note: "no-matching-bars-in-window" };
    return { pct, status: "OK", note: null, marketDataSource: "INJECTED" };
  }

  const src = await fetchDailyBars({ symbol: ticker, fromYmd, toYmd });
  if (src.status !== "OK" || !Array.isArray(src.bars) || src.bars.length === 0) {
    return {
      pct: null,
      status: "DATA_UNAVAILABLE",
      note: src.fallbackReason || "bench-bars-unavailable",
      marketDataSource: src.marketDataSource,
      fallbackUsed: src.fallbackUsed,
      actualRange: src.actualRange,
      fetchAsOf: src.fetchAsOf,
    };
  }
  const pct = returnBetween(src.bars, fromYmd, toYmd);
  if (pct == null) {
    return {
      pct: null,
      status: "DATA_UNAVAILABLE",
      note: "no-matching-bars-in-window",
      marketDataSource: src.marketDataSource,
      fallbackUsed: src.fallbackUsed,
      actualRange: src.actualRange,
      fetchAsOf: src.fetchAsOf,
    };
  }
  return {
    pct,
    status: "OK",
    note: null,
    marketDataSource: src.marketDataSource,
    fallbackUsed: src.fallbackUsed,
    actualRange: src.actualRange,
    fetchAsOf: src.fetchAsOf,
  };
}

// PUBLIC — matched alpha. Returns null if EITHER side is not a finite
// number — never masks missing data as zero.
export function getMatchedAlphaPct({ securityReturnPct, benchmarkReturnPct }) {
  if (!Number.isFinite(securityReturnPct) || !Number.isFinite(benchmarkReturnPct)) return null;
  return securityReturnPct - benchmarkReturnPct;
}
