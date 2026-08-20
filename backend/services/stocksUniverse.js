// backend/services/stocksUniverse.js
//
// Phase-2 audit fix #2: expand the investable universe from ~80 curated
// names to ~2,000-5,000 liquid US + Canadian equities.
//
// Old universe: hard-coded DEFAULT_UNIVERSE in stocksDailyPickEngine.js
// plus the user's holdings and recent recs — capped at 80. Which meant
// the pick engine could only discover the best stock among stocks it
// already knew about. Per audit feedback: "It cannot find an obscure
// $4B company with earnings estimates suddenly revised upward 40% if
// that company never entered the pool."
//
// This module pulls a broad liquid-equities list from FMP's screener
// once per day (cheap; cached to Mongo) and returns it as a Set that
// the two-stage pick pipeline pre-screens against.
//
// Design:
//   • Two markets: NASDAQ+NYSE (US) and TSX (Canadian).
//   • Liquidity floor: mktCap >= $500M AND avg volume >= $5M USD/day.
//     Removes penny-stock chaos and shells that would waste ranking cycles.
//   • Refresh cadence: once a day. FMP's screener returns thousands
//     of rows in a single call, so this is one API hit per market
//     per day.
//   • Fallback: if FMP is unavailable, return the legacy curated list
//     so the pick engine keeps working with a smaller universe.
//   • Cached in-memory (module scope) so the 2-3k list is not
//     re-parsed on every pick tick.

import mongoose from "mongoose";
import { isFmpEnabled } from "./fmpEnabled.js";

const LIQUIDITY_MIN_MCAP_USD = 500_000_000;      // $500M market cap
const LIQUIDITY_MIN_AVG_VOL_USD = 5_000_000;     // $5M / day dollar volume
const MAX_UNIVERSE_SIZE = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;        // refresh daily

// ─── Mongo persistence — one row per (market, ymd) ────────────────────
const StocksUniverseCacheSchema = new mongoose.Schema({
  market: { type: String, required: true, index: true },  // "US" | "CA"
  ymd: { type: String, required: true, index: true },
  tickers: [{ type: String }],                              // uppercase, with exchange suffix for CA
  fetchedAt: { type: Date, default: Date.now },
}, { collection: "stocks_universe_cache" });
StocksUniverseCacheSchema.index({ market: 1, ymd: 1 }, { unique: true });
const StocksUniverseCache = mongoose.models.StocksUniverseCache
  || mongoose.model("StocksUniverseCache", StocksUniverseCacheSchema);

// In-memory hot cache — avoids re-parsing the 2-3k list on every tick.
const MEM_CACHE = { at: 0, tickers: null };

function ymdKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// FMP stable screener call. Returns array of { symbol, exchange, marketCap, ... }.
async function fetchFmpScreener({ market, exchange, marketCapMoreThan, volumeMoreThan, limit = 5000 }) {
  const key = process.env.FMP_API_KEY || "";
  if (!key) return null;
  const params = new URLSearchParams();
  if (exchange) params.set("exchange", exchange);
  if (marketCapMoreThan) params.set("marketCapMoreThan", String(marketCapMoreThan));
  if (volumeMoreThan) params.set("volumeMoreThan", String(volumeMoreThan));
  params.set("limit", String(limit));
  params.set("isActivelyTrading", "true");
  params.set("apikey", key);
  const url = `https://financialmodelingprep.com/stable/company-screener?${params.toString()}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      console.warn(`[universe] FMP screener ${market} ${r.status}`);
      return null;
    }
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  } catch (e) {
    console.warn(`[universe] FMP screener ${market} threw:`, e?.message);
    return null;
  } finally { clearTimeout(tid); }
}

// Convert an FMP screener row to a Yahoo-format ticker (adds .TO / .V for
// Canadian listings). Filters out non-common-stock instruments (units,
// warrants, preferreds — anything with non-alpha in the base symbol).
function normalizeToYahooTicker(row, market) {
  const sym = String(row?.symbol || "").toUpperCase().trim();
  if (!sym) return null;
  // Reject weird symbols (units WT, warrants W, preferred P/PR).
  if (!/^[A-Z]{1,5}([.-][A-Z]{1,3})?$/.test(sym)) return null;
  if (market === "CA") {
    // FMP CA symbols already look like "RY.TO" / "SHOP.TO". If not
    // suffixed, add .TO.
    if (sym.includes(".")) return sym;
    return `${sym}.TO`;
  }
  return sym;
}

async function loadFromMongoIfFresh(market) {
  try {
    const row = await StocksUniverseCache.findOne({ market, ymd: ymdKey() }).lean();
    if (row && Array.isArray(row.tickers) && row.tickers.length > 100) {
      return row.tickers;
    }
  } catch { /* fall through */ }
  return null;
}

async function saveToMongo(market, tickers) {
  try {
    await StocksUniverseCache.updateOne(
      { market, ymd: ymdKey() },
      { $set: { tickers, fetchedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) { console.warn(`[universe] mongo save ${market} failed:`, e?.message); }
}

async function loadUsUniverse() {
  const cached = await loadFromMongoIfFresh("US");
  if (cached) return cached;
  // NASDAQ + NYSE + AMEX in one call, most-liquid names.
  const [nas, nyse] = await Promise.all([
    fetchFmpScreener({ market: "US", exchange: "nasdaq", marketCapMoreThan: LIQUIDITY_MIN_MCAP_USD, volumeMoreThan: 100_000 }),
    fetchFmpScreener({ market: "US", exchange: "nyse", marketCapMoreThan: LIQUIDITY_MIN_MCAP_USD, volumeMoreThan: 100_000 }),
  ]);
  if (!nas && !nyse) return null;
  const all = [...(nas || []), ...(nyse || [])];
  const tickers = all
    .filter(row => Number(row?.marketCap) >= LIQUIDITY_MIN_MCAP_USD)
    .filter(row => {
      // Dollar volume estimate: volume × price ≈ dollar volume. If FMP
      // exposes volumeAvg use it; otherwise skip this filter (better
      // to keep too many than reject silently).
      const vol = Number(row?.volume) || Number(row?.avgVolume) || 0;
      const price = Number(row?.price) || 0;
      if (vol <= 0 || price <= 0) return true;
      return vol * price >= LIQUIDITY_MIN_AVG_VOL_USD;
    })
    .map(row => normalizeToYahooTicker(row, "US"))
    .filter(Boolean);
  const unique = [...new Set(tickers)];
  await saveToMongo("US", unique);
  return unique;
}

async function loadCaUniverse() {
  const cached = await loadFromMongoIfFresh("CA");
  if (cached) return cached;
  const rows = await fetchFmpScreener({ market: "CA", exchange: "tsx", marketCapMoreThan: LIQUIDITY_MIN_MCAP_USD, volumeMoreThan: 50_000 });
  if (!rows) return null;
  const tickers = rows
    .filter(row => Number(row?.marketCap) >= LIQUIDITY_MIN_MCAP_USD)
    .map(row => normalizeToYahooTicker(row, "CA"))
    .filter(Boolean);
  const unique = [...new Set(tickers)];
  await saveToMongo("CA", unique);
  return unique;
}

// Interleave two arrays proportional to a ratio so slice(0, N) always
// takes both markets in the intended mix. Round-robin picks from US
// with weight caRatio.us and CA with weight caRatio.ca; when one
// stream exhausts, the remainder from the other stream fills in.
// Example: ratioUs=0.70, ratioCa=0.30 → for every 10 slots, 7 US + 3 CA.
function interleaveProportional(us, ca, { ratioUs = 0.70, ratioCa = 0.30 } = {}) {
  const out = [];
  const seen = new Set();
  let i = 0, j = 0;
  // Running "credits" — each iteration adds the ratio and, whichever
  // side crosses 1.0 first, emit from that stream and subtract 1.
  let creditUs = 0, creditCa = 0;
  const push = (arr, idx) => {
    const t = arr[idx];
    if (t && !seen.has(t)) { out.push(t); seen.add(t); }
  };
  while (i < us.length || j < ca.length) {
    creditUs += ratioUs;
    creditCa += ratioCa;
    if (creditUs >= creditCa) {
      if (i < us.length) { push(us, i); i++; creditUs -= 1; }
      else if (j < ca.length) { push(ca, j); j++; creditCa -= 1; }
    } else {
      if (j < ca.length) { push(ca, j); j++; creditCa -= 1; }
      else if (i < us.length) { push(us, i); i++; creditUs -= 1; }
    }
  }
  return out;
}

// Public: return the broad US+CA universe. Merges in-memory cache
// (~24h) → Mongo (~24h/ymd) → live FMP screener. Never throws —
// returns empty array on total failure so the pick engine can fall
// back to its curated default.
//
// Interleaves US and CA proportionally so a downstream `slice(0, cap)`
// never silently drops the entire TSX universe when US name-count
// exceeds the cap (audit finding: US alone can return >500 rows).
// Default 70/30 mix; override via STOCKS_UNIVERSE_US_RATIO env
// (accepts 0..1; CA gets the complement).
export async function getBroadUniverse() {
  const now = Date.now();
  if (MEM_CACHE.tickers && now - MEM_CACHE.at < CACHE_TTL_MS) return MEM_CACHE.tickers;

  if (!isFmpEnabled()) {
    console.log("[universe] FMP disabled — returning empty broad universe");
    return [];
  }

  try {
    const [us, ca] = await Promise.all([
      loadUsUniverse().catch(e => { console.warn("[universe] US load failed:", e?.message); return null; }),
      loadCaUniverse().catch(e => { console.warn("[universe] CA load failed:", e?.message); return null; }),
    ]);
    const usArr = us || [];
    const caArr = ca || [];
    const envRatio = Number(process.env.STOCKS_UNIVERSE_US_RATIO);
    const ratioUs = Number.isFinite(envRatio) && envRatio >= 0.1 && envRatio <= 0.95 ? envRatio : 0.70;
    const ratioCa = 1 - ratioUs;
    const merged = interleaveProportional(usArr, caArr, { ratioUs, ratioCa }).slice(0, MAX_UNIVERSE_SIZE);
    MEM_CACHE.at = now;
    MEM_CACHE.tickers = merged;
    // Log the CA share of the top-500 to prove the fix is behaving.
    const top500 = merged.slice(0, 500);
    const caInTop500 = top500.filter(t => t.endsWith(".TO") || t.endsWith(".V")).length;
    console.log(`[universe] loaded broad universe — US=${usArr.length}, CA=${caArr.length}, merged=${merged.length}, top500 has ${caInTop500} CA (ratio ${ratioUs.toFixed(2)}/${ratioCa.toFixed(2)})`);
    return merged;
  } catch (e) {
    console.warn("[universe] getBroadUniverse failed:", e?.message);
    return [];
  }
}

// For tests + diagnostics.
export const UNIVERSE_CONSTANTS = {
  LIQUIDITY_MIN_MCAP_USD,
  LIQUIDITY_MIN_AVG_VOL_USD,
  MAX_UNIVERSE_SIZE,
  CACHE_TTL_MS,
};
