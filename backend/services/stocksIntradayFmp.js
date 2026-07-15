// backend/services/stocksIntradayFmp.js
//
// Intraday bars + real-time quotes from FMP. Two things this unlocks:
//   1. Multi-timeframe confluence (weekly trend + daily setup + 1h/15m
//      trigger) — the professional swing-trade workflow.
//   2. Real-time alerts — the alerts cron can check the live price
//      instead of Yahoo's 15-min-delayed cached daily close.
//
// Two caches with very different TTLs:
//   • Real-time quote: 60s — fresh enough for alerts, avoids per-tick
//     hammering when 5 alerts share a symbol.
//   • Intraday bars: 15min for 15m interval, 1h for 1h interval.
//
// Fail-open: any FMP hiccup returns null and the caller falls back to
// whatever behavior it had before intraday was wired in.

import { isFmpEnabled } from "./fmpEnabled.js";

const QUOTE_CACHE = new Map(); // sym → { fetchedAt, quote }
const BARS_CACHE = new Map();  // `${sym}|${interval}` → { fetchedAt, bars }
const QUOTE_TTL_MS = 60 * 1000;
const BARS_TTL = { "15min": 15 * 60 * 1000, "1hour": 60 * 60 * 1000, "4hour": 4 * 60 * 60 * 1000 };

function fmpKey() { return process.env.FMP_API_KEY || ""; }

// FMP normalizes CAD tickers with .TO suffix — mirror stocksFundamentals.
function normalizeForFmp(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(".")) return t;
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

async function fmpFetch(path) {
  const key = fmpKey();
  if (!key) return { ok: false, status: 0, body: "" };
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: `network: ${e?.message || e}` };
  } finally { clearTimeout(tid); }
}

// Real-time quote — {price, change, volume, avgVolume, dayHigh, dayLow,
// previousClose, timestamp}. Returns null if unavailable.
export async function getRealtimeQuote(ticker, currency = "USD") {
  if (!isFmpEnabled()) return null;
  const sym = normalizeForFmp(ticker, currency);
  const now = Date.now();
  const cached = QUOTE_CACHE.get(sym);
  if (cached && now - cached.fetchedAt < QUOTE_TTL_MS) return cached.quote;

  // Try /stable first (newer keys), fall back to /api/v3 (legacy).
  let res = await fmpFetch(`/stable/quote?symbol=${encodeURIComponent(sym)}`);
  if (!res.ok || !res.body) {
    res = await fmpFetch(`/api/v3/quote/${encodeURIComponent(sym)}`);
  }
  if (!res.ok) return null;
  let arr; try { arr = JSON.parse(res.body); } catch { return null; }
  const q = Array.isArray(arr) ? arr[0] : arr;
  if (!q || !Number.isFinite(q.price)) return null;
  const quote = {
    ticker: sym,
    price: q.price,
    change: q.change ?? null,
    changePct: q.changesPercentage ?? null,
    volume: q.volume ?? null,
    avgVolume: q.avgVolume ?? null,
    dayHigh: q.dayHigh ?? null,
    dayLow: q.dayLow ?? null,
    previousClose: q.previousClose ?? null,
    timestamp: q.timestamp ? new Date(q.timestamp * 1000) : new Date(),
  };
  QUOTE_CACHE.set(sym, { fetchedAt: now, quote });
  return quote;
}

// Intraday OHLC bars. `interval` must be "15min" | "1hour" | "4hour".
// Returns [{ t, open, high, low, close, volume }, ...] most-recent-last.
// null on failure. Cached per interval.
export async function getIntradayBars(ticker, interval = "1hour", currency = "USD") {
  if (!isFmpEnabled()) return null;
  if (!BARS_TTL[interval]) return null;
  const sym = normalizeForFmp(ticker, currency);
  const key = `${sym}|${interval}`;
  const now = Date.now();
  const cached = BARS_CACHE.get(key);
  if (cached && now - cached.fetchedAt < BARS_TTL[interval]) return cached.bars;

  let res = await fmpFetch(`/stable/historical-chart/${interval}?symbol=${encodeURIComponent(sym)}`);
  if (!res.ok || !res.body) {
    res = await fmpFetch(`/api/v3/historical-chart/${interval}/${encodeURIComponent(sym)}`);
  }
  if (!res.ok) return null;
  let arr; try { arr = JSON.parse(res.body); } catch { return null; }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // FMP returns most-recent-FIRST — flip to chronological.
  const bars = arr
    .slice()
    .reverse()
    .filter((b) => Number.isFinite(b.close) && Number.isFinite(b.high) && Number.isFinite(b.low))
    .map((b) => ({
      t: b.date ? new Date(b.date).getTime() / 1000 : null,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 0,
    }));
  BARS_CACHE.set(key, { fetchedAt: now, bars });
  return bars;
}

// Multi-timeframe confluence — the pro swing workflow condensed. Reads:
//   • Daily bars (already fetched by getTechnicals — passed in)
//   • 1h bars (FMP)
//   • 15m bars (FMP) — optional but useful for tightest entries
// Emits an "aligned / mixed / conflicting" verdict plus a per-timeframe
// bias so the AI can quote which frames confirm and which don't.
export async function getMultiTimeframeConfluence(ticker, dailyPoints, currency = "USD") {
  if (!Array.isArray(dailyPoints) || dailyPoints.length < 60) return null;

  const trend = (points) => {
    if (!points || points.length < 20) return null;
    const closes = points.map((p) => p.close);
    const last = closes[closes.length - 1];
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const bias = last > sma20 * 1.005 ? "up" : last < sma20 * 0.995 ? "down" : "neutral";
    const pctVsSma20 = ((last - sma20) / sma20) * 100;
    return { bias, last, sma20, pctVsSma20 };
  };

  // Weekly-ish: use last 50 daily bars (~10 weeks) with a 10-bar SMA cross vs 30-bar.
  const wkClosesShort = dailyPoints.slice(-10).map((p) => p.close);
  const wkClosesLong = dailyPoints.slice(-30).map((p) => p.close);
  const wkSmaShort = wkClosesShort.reduce((a, b) => a + b, 0) / wkClosesShort.length;
  const wkSmaLong = wkClosesLong.reduce((a, b) => a + b, 0) / wkClosesLong.length;
  const weekly = { bias: wkSmaShort > wkSmaLong ? "up" : wkSmaShort < wkSmaLong ? "down" : "neutral", sma10: wkSmaShort, sma30: wkSmaLong };

  const daily = trend(dailyPoints);

  const [hourly, min15] = await Promise.all([
    getIntradayBars(ticker, "1hour", currency),
    getIntradayBars(ticker, "15min", currency),
  ]);

  const hourlyTrend = trend(hourly);
  const min15Trend = trend(min15);

  const biases = [weekly.bias, daily?.bias, hourlyTrend?.bias, min15Trend?.bias].filter((b) => b && b !== "neutral");
  const ups = biases.filter((b) => b === "up").length;
  const downs = biases.filter((b) => b === "down").length;
  let confluence = "mixed";
  let direction = null;
  if (ups >= 3 && downs === 0) { confluence = "aligned"; direction = "up"; }
  else if (downs >= 3 && ups === 0) { confluence = "aligned"; direction = "down"; }
  else if (ups > 0 && downs > 0) confluence = "conflicting";

  return {
    confluence,
    direction,
    weekly,
    daily: daily ? { bias: daily.bias, pctVsSma20: daily.pctVsSma20 } : null,
    hourly: hourlyTrend ? { bias: hourlyTrend.bias, pctVsSma20: hourlyTrend.pctVsSma20 } : null,
    min15: min15Trend ? { bias: min15Trend.bias, pctVsSma20: min15Trend.pctVsSma20 } : null,
    hourlyBarsAvailable: Array.isArray(hourly) && hourly.length > 0,
    min15BarsAvailable: Array.isArray(min15) && min15.length > 0,
  };
}

export function formatConfluenceLine(mtf) {
  if (!mtf) return null;
  const emoji = mtf.confluence === "aligned"
    ? (mtf.direction === "up" ? "🟢🟢🟢 ALIGNED UP" : "🔴🔴🔴 ALIGNED DOWN")
    : mtf.confluence === "conflicting" ? "🟡 CONFLICTING FRAMES" : "⚪ mixed";
  const per = [
    `wk ${mtf.weekly?.bias || "—"}`,
    `d ${mtf.daily?.bias || "—"}`,
    `1h ${mtf.hourly?.bias || (mtf.hourlyBarsAvailable ? "—" : "no data")}`,
    `15m ${mtf.min15?.bias || (mtf.min15BarsAvailable ? "—" : "no data")}`,
  ].join(" · ");
  return `MTF: ${emoji} [${per}]`;
}
