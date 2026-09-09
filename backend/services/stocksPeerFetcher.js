// backend/services/stocksPeerFetcher.js
//
// P2.5 (2026-09-09) — real FMP peer fetcher. Returns a de-duplicated
// list of peer tickers for a symbol from FMP's stock-peers endpoint.
//
// Callers (stocksIndustryStrength.js) enforce a MINIMUM peer count
// before treating the industry-strength score as "real"; below that
// count they fall back to sector-strength EXPLICITLY (source stamp
// distinguishes the two).
//
// Cache TTL 12h — the peer set doesn't move meaningfully day-to-day.
// Fail-open: returns [] on any error so callers see "no peers" (which
// triggers the sector fallback).

import { isFmpEnabled } from "./fmpEnabled.js";

const FMP_BASE = "https://financialmodelingprep.com";
const TIMEOUT_MS = Number(process.env.STOCKS_FMP_TIMEOUT_MS) || 8000;
const CACHE = new Map();
const CACHE_TTL_MS = 12 * 3600 * 1000;

function fmpKey() { return process.env.FMP_API_KEY || ""; }
async function fmpGet(path) {
  if (!fmpKey()) throw new Error("FMP_API_KEY not configured");
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(fmpKey())}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`fmp ${r.status}`);
    return await r.json();
  } finally { clearTimeout(tid); }
}

// PUBLIC — return an array of peer tickers (may be empty).
export async function fetchPeers(ticker) {
  if (!ticker || !isFmpEnabled()) return [];
  const key = String(ticker).toUpperCase();
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value = [];
  try {
    const raw = await fmpGet(`/api/v4/stock_peers?symbol=${encodeURIComponent(key)}`);
    // FMP v4 shape: [{ symbol: "AAPL", peersList: ["MSFT","GOOGL",…] }]
    const row = Array.isArray(raw) ? raw[0] : null;
    if (row && Array.isArray(row.peersList)) {
      value = [...new Set(row.peersList.map(s => String(s).toUpperCase()).filter(s => s && s !== key))];
    }
  } catch (e) {
    // fall through — cache empty result briefly (short TTL) so a
    // subsequent call in the same tick doesn't refetch.
    CACHE.set(key, { at: Date.now() - CACHE_TTL_MS + 60_000, value: [] });
    return [];
  }
  CACHE.set(key, { at: Date.now(), value });
  return value;
}
