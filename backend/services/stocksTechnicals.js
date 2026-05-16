// backend/services/stocksTechnicals.js
//
// Computes technical indicators from Yahoo Finance daily price history.
// Used by the AI advice + briefing pipelines so the model has reliable
// numbers (RSI, SMA50, SMA200, recent cross events) instead of guessing
// from scraped web pages.
//
// All math is local; the only external call is Yahoo's chart endpoint
// for 1Y of daily closes per ticker. Results are cached for 1h.

const CACHE = new Map(); // ticker → { fetchedAt, data }
const TTL_MS = 60 * 60 * 1000; // 1 hour
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

async function fetchDailyOHLC(ticker, days = 260) {
  const url = `${YAHOO_BASE}${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Tech Indicators)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const closes = q.close || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null && Number.isFinite(closes[i])) {
        points.push({
          t: timestamps[i],
          close: closes[i],
          high: Number.isFinite(highs[i]) ? highs[i] : closes[i],
          low: Number.isFinite(lows[i]) ? lows[i] : closes[i],
        });
      }
    }
    return { points: points.slice(-days), currency: result?.meta?.currency || "USD" };
  } finally {
    clearTimeout(tid);
  }
}

function sma(values, n) {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

// Wilder's RSI(14) — the standard
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  // Initial average gain/loss over the first `period` deltas
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  // Wilder smoothing for the rest of the series
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Detect golden/death cross in the last N days. Golden = SMA50 crosses above
// SMA200; Death = SMA50 crosses below. Returns { type, daysAgo } or null.
function recentCross(closes, lookback = 60) {
  if (closes.length < 200 + lookback) return null;
  // Walk back day by day, compute SMA50/200 at each, detect sign flip
  let prevSign = null;
  for (let backIdx = lookback; backIdx >= 0; backIdx--) {
    const endIdx = closes.length - 1 - backIdx;
    if (endIdx < 199) continue;
    const window50 = closes.slice(endIdx - 49, endIdx + 1);
    const window200 = closes.slice(endIdx - 199, endIdx + 1);
    const s50 = window50.reduce((a, b) => a + b, 0) / 50;
    const s200 = window200.reduce((a, b) => a + b, 0) / 200;
    const sign = s50 > s200 ? 1 : -1;
    if (prevSign != null && sign !== prevSign) {
      return { type: sign > 0 ? "golden" : "death", daysAgo: backIdx };
    }
    prevSign = sign;
  }
  return null;
}

export async function getTechnicals(ticker) {
  const now = Date.now();
  const cached = CACHE.get(ticker);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  let data;
  try {
    const { points, currency } = await fetchDailyOHLC(ticker, 260);
    if (points.length < 50) {
      data = { ok: false, reason: "insufficient history" };
    } else {
      const closes = points.map(p => p.close);
      const last = closes[closes.length - 1];
      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);
      const rsi14 = rsi(closes, 14);
      const cross = recentCross(closes, 60);

      // Volatility — std dev of daily returns over last 20 days (annualised)
      let vol = null;
      if (closes.length >= 21) {
        const returns = [];
        for (let i = closes.length - 20; i < closes.length; i++) {
          returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
        vol = Math.sqrt(variance) * Math.sqrt(252) * 100; // annualised %
      }

      // ATR(14) — average true range. The senior-analyst sizing tool.
      // TR = max(high-low, |high-prevClose|, |low-prevClose|)
      let atr14 = null;
      if (points.length >= 15) {
        const trs = [];
        for (let i = 1; i < points.length; i++) {
          const p = points[i], prev = points[i - 1];
          const tr = Math.max(
            p.high - p.low,
            Math.abs(p.high - prev.close),
            Math.abs(p.low - prev.close)
          );
          trs.push(tr);
        }
        // Wilder smoothing
        let atr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
        for (let i = 14; i < trs.length; i++) {
          atr = (atr * 13 + trs[i]) / 14;
        }
        atr14 = atr;
      }

      data = {
        ok: true,
        currency,
        last,
        sma20, sma50, sma200,
        rsi14,
        recentCross: cross,
        annualizedVolPct: vol,
        atr14,
        atrPctOfPrice: atr14 != null && last ? (atr14 / last) * 100 : null,
        priceVsSma50: sma50 ? ((last - sma50) / sma50) * 100 : null,
        priceVsSma200: sma200 ? ((last - sma200) / sma200) * 100 : null,
        // Suggested 2.5-ATR stop level (the senior-analyst default)
        suggested25AtrStop: atr14 != null ? last - 2.5 * atr14 : null,
      };
    }
  } catch (e) {
    data = { ok: false, reason: e?.message || "fetch failed" };
  }

  CACHE.set(ticker, { fetchedAt: now, data });
  return data;
}

// Convenience: format a technicals object as one human-readable line for
// injection into the AI prompt.
export function formatTechnicalsLine(t) {
  if (!t || !t.ok) return `Technicals: unavailable${t?.reason ? ` (${t.reason})` : ""}`;
  const parts = [];
  if (t.rsi14 != null) {
    const label = t.rsi14 > 70 ? "overbought" : t.rsi14 < 30 ? "oversold" : "neutral";
    parts.push(`RSI ${t.rsi14.toFixed(0)} (${label})`);
  }
  if (t.sma50 != null && t.priceVsSma50 != null) {
    parts.push(`SMA50 $${t.sma50.toFixed(2)} (${t.priceVsSma50 >= 0 ? "+" : ""}${t.priceVsSma50.toFixed(1)}%)`);
  }
  if (t.sma200 != null && t.priceVsSma200 != null) {
    parts.push(`SMA200 $${t.sma200.toFixed(2)} (${t.priceVsSma200 >= 0 ? "+" : ""}${t.priceVsSma200.toFixed(1)}%)`);
  }
  if (t.recentCross) {
    parts.push(`${t.recentCross.type === "golden" ? "🌟 golden cross" : "💀 death cross"} ${t.recentCross.daysAgo}d ago`);
  }
  if (t.annualizedVolPct != null) parts.push(`vol ${t.annualizedVolPct.toFixed(0)}%`);
  if (t.atr14 != null) parts.push(`ATR $${t.atr14.toFixed(2)} (${t.atrPctOfPrice.toFixed(1)}%) → 2.5×ATR stop $${t.suggested25AtrStop.toFixed(2)}`);
  return parts.join(" · ");
}
