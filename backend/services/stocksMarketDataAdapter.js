// backend/services/stocksMarketDataAdapter.js
//
// P3.6 (2026-09-10) — resilient benchmark/market-data adapter.
//
// PRIMARY:  Yahoo v8 chart (existing fetchYahooDaily, now shape-corrected
//           to emit .date on every bar).
// SECONDARY: FMP /api/v3/historical-price-full (used ONLY when Yahoo
//           returns nothing at all, never to plug a hole in a range).
// FINAL:    null + status:"DATA_UNAVAILABLE".
//
// Every response carries provenance the caller can persist:
//   { bars, marketDataSource, fallbackUsed, requestedRange, actualRange,
//     fetchAsOf, status }
//
// Absence-of-data ≠ zero return. Callers should propagate null / DATA_UNAVAILABLE
// upward; the null-not-zero contract is enforced in stocksBenchmarkMatched.js.

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY || "";
const FMP_HISTORICAL_BASE = "https://financialmodelingprep.com/api/v3/historical-price-full";

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

async function fetchFmpDaily(symbol, fromYmd, toYmd) {
  if (!FMP_KEY) return { bars: null, ok: false, reason: "no-fmp-key" };
  // FMP uses ^GSPC etc; for TSX/Yahoo suffixes like .TO, FMP supports the same
  // suffix; we forward verbatim and let the caller retry sans-suffix if empty.
  const url = `${FMP_HISTORICAL_BASE}/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}` +
              (fromYmd ? `&from=${fromYmd}` : "") + (toYmd ? `&to=${toYmd}` : "");
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Curriculate/1.0" } });
    if (!r.ok) return { bars: null, ok: false, reason: `fmp-http-${r.status}` };
    const j = await r.json().catch(() => null);
    const raw = Array.isArray(j?.historical) ? j.historical : [];
    // FMP returns newest-first; sort ascending and normalize shape.
    const bars = raw
      .filter(b => b && Number.isFinite(b.close))
      .map(b => ({
        date: b.date,
        t: Math.floor(new Date(b.date).getTime() / 1000),
        open: Number.isFinite(b.open) ? b.open : b.close,
        high: Number.isFinite(b.high) ? b.high : b.close,
        low: Number.isFinite(b.low) ? b.low : b.close,
        close: b.close,
        volume: b.volume ?? null,
        vol: b.volume ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { bars: bars.length ? bars : null, ok: bars.length > 0 };
  } catch (e) {
    return { bars: null, ok: false, reason: e?.message || "fmp-error" };
  } finally {
    clearTimeout(tid);
  }
}

// Map an approximate window to a Yahoo range string. Yahoo range=2y covers
// most windows the attribution engine asks for.
function yahooRangeFor({ fromYmd, toYmd }) {
  if (!fromYmd) return "2y";
  const days = Math.max(1, Math.round((new Date(toYmd || Date.now()) - new Date(fromYmd)) / 86400_000));
  if (days <= 7) return "1mo";
  if (days <= 30) return "3mo";
  if (days <= 90) return "6mo";
  if (days <= 180) return "1y";
  if (days <= 365) return "2y";
  return "5y";
}

// PUBLIC — fetch daily bars for `symbol` covering [fromYmd, toYmd].
// Guarantees each bar has a .date field (YMD) and .close numeric.
export async function fetchDailyBars({ symbol, fromYmd = null, toYmd = null } = {}) {
  const requestedRange = { fromYmd, toYmd };
  const fetchAsOf = new Date().toISOString();

  // Primary: Yahoo.
  const yahooRange = yahooRangeFor({ fromYmd, toYmd });
  const yahooBars = await fetchYahooDaily(symbol, yahooRange).catch(() => null);
  if (Array.isArray(yahooBars) && yahooBars.length > 0) {
    // Confirm coverage — if the requested window is entirely inside the
    // returned bars, Yahoo is authoritative. If not, keep the Yahoo
    // bars we have (partial coverage is still useful) and note it.
    const firstBar = yahooBars[0]?.date || null;
    const lastBar = yahooBars[yahooBars.length - 1]?.date || null;
    return {
      bars: yahooBars,
      marketDataSource: "YAHOO",
      fallbackUsed: false,
      requestedRange,
      actualRange: { fromYmd: firstBar, toYmd: lastBar },
      fetchAsOf,
      status: "OK",
    };
  }

  // Secondary: FMP. Only when Yahoo returned nothing.
  const fmp = await fetchFmpDaily(symbol, fromYmd, toYmd);
  if (fmp.ok && Array.isArray(fmp.bars) && fmp.bars.length > 0) {
    return {
      bars: fmp.bars,
      marketDataSource: "FMP",
      fallbackUsed: true,
      requestedRange,
      actualRange: { fromYmd: fmp.bars[0].date, toYmd: fmp.bars[fmp.bars.length - 1].date },
      fetchAsOf,
      status: "OK",
      fallbackReason: "yahoo-empty",
    };
  }

  // FINAL: unavailable — never fabricate.
  return {
    bars: null,
    marketDataSource: null,
    fallbackUsed: false,
    requestedRange,
    actualRange: null,
    fetchAsOf,
    status: "DATA_UNAVAILABLE",
    fallbackReason: fmp.reason || "no-source",
  };
}

// PUBLIC — passthrough to test the FMP path directly.
export const _fetchFmpDaily = fetchFmpDaily;
