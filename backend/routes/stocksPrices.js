// backend/routes/stocksPrices.js
//
// Server-side proxy for live equity prices.
// The browser can't hit Yahoo Finance directly (CORS); we proxy here.
//
// POST /api/stocks-prices
//   Body: { tickers: ["DJT","TSLA","NVDA",...] }   (max 50)
//   Resp: { prices: { DJT: { price, currency, changePct }, ... },
//           failed: ["XYZ", ...] }
//
// Cached in-memory for 60s per ticker so a busy page doesn't hammer Yahoo.
// No auth required — these are public quotes.

import express from "express";

const router = express.Router();
const CACHE = new Map(); // ticker -> { price, currency, changePct, fetchedAt }
const CACHE_TTL_MS = 60 * 1000;
const MAX_TICKERS_PER_CALL = 50;
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

async function fetchOne(ticker) {
  // Yahoo expects URL-encoded tickers (e.g. SLV.V → SLV.V is OK; BRK.B → BRK.B)
  const url = `${YAHOO_BASE}${encodeURIComponent(ticker)}?interval=1d&range=2d`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      // Yahoo blocks the default Node user-agent in some cases.
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Stocks Proxy)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error("no price in response");
    const price = meta.regularMarketPrice;
    const prevClose =
      meta.chartPreviousClose ??
      meta.previousClose ??
      meta.regularMarketPreviousClose ??
      null;
    const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
    return { price, currency: meta.currency || "USD", changePct };
  } finally {
    clearTimeout(tid);
  }
}

router.post("/", express.json({ limit: "16kb" }), async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.tickers) ? req.body.tickers : null;
    if (!raw) return res.status(400).json({ error: "tickers[] required" });
    const tickers = [
      ...new Set(
        raw
          .map((t) => (typeof t === "string" ? t.trim().toUpperCase() : ""))
          .filter((t) => /^[A-Z0-9.\-]{1,16}$/.test(t))
      ),
    ].slice(0, MAX_TICKERS_PER_CALL);

    const now = Date.now();
    const prices = {};
    const failed = [];
    const toFetch = [];

    for (const t of tickers) {
      const cached = CACHE.get(t);
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        prices[t] = { price: cached.price, currency: cached.currency, changePct: cached.changePct };
      } else {
        toFetch.push(t);
      }
    }

    // Fetch missing in parallel (Yahoo handles concurrent requests fine)
    await Promise.all(
      toFetch.map(async (t) => {
        try {
          const r = await fetchOne(t);
          CACHE.set(t, { ...r, fetchedAt: now });
          prices[t] = r;
        } catch (e) {
          failed.push(t);
        }
      })
    );

    res.json({ prices, failed, cachedAt: now });
  } catch (err) {
    console.error("stocks-prices error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/stocks-prices/history
//   Body: { tickers: [...], range: "1d" | "3d" | "7d" | "30d" }
//   Resp: { range, data: { TICKER: { points: [{t, price, pct}], currency } }, failed: [...] }
//
// Each point: t = unix seconds, price = native currency, pct = % change from
// the first valid price in the range (so all lines start at 0%).
//
// Cached in-memory for 60s per (ticker, range).
// ─────────────────────────────────────────────────────────────────────
const HISTORY_CACHE = new Map();
const HISTORY_TTL_MS = 60 * 1000;

// Map UI range → (Yahoo range, Yahoo interval)
function yahooRangeFor(uiRange) {
  switch (uiRange) {
    case "1d":  return { range: "1d",  interval: "5m"  };
    case "3d":  return { range: "5d",  interval: "30m" };
    case "7d":  return { range: "5d",  interval: "60m" };
    case "30d": return { range: "1mo", interval: "1d"  };
    case "1y":  return { range: "1y",  interval: "1d"  };
    case "2y":  return { range: "2y",  interval: "1wk" };
    default:    return { range: "1mo", interval: "1d"  };
  }
}

// Trim the series to the last N calendar days based on uiRange
function trimToRange(points, uiRange) {
  if (!points.length) return points;
  const lastT = points[points.length - 1].t;
  let days = 30;
  if (uiRange === "1d") days = 1.1;
  else if (uiRange === "3d") days = 3.1;
  else if (uiRange === "7d") days = 7.1;
  else if (uiRange === "30d") days = 30.1;
  else if (uiRange === "1y") days = 366;
  else if (uiRange === "2y") days = 732;
  const cutoff = lastT - days * 86400;
  return points.filter((p) => p.t >= cutoff);
}

async function fetchHistory(ticker, uiRange) {
  const { range, interval } = yahooRangeFor(uiRange);
  const url = `${YAHOO_BASE}${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Stocks Proxy)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) throw new Error("empty chart result");
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const currency = result.meta?.currency || "USD";

    // Pair timestamps with prices, drop nulls
    const raw = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c != null && Number.isFinite(c)) {
        raw.push({ t: timestamps[i], price: c });
      }
    }
    if (raw.length === 0) throw new Error("no valid prices");

    // Trim to requested range
    const trimmed = trimToRange(raw, uiRange);
    if (trimmed.length === 0) throw new Error("trim removed all points");

    // % change from first valid price in the trimmed window
    const base = trimmed[0].price;
    const points = trimmed.map((p) => ({
      t: p.t,
      price: p.price,
      pct: ((p.price - base) / base) * 100,
    }));

    return { points, currency };
  } finally {
    clearTimeout(tid);
  }
}

router.post("/history", express.json({ limit: "16kb" }), async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.tickers) ? req.body.tickers : null;
    const range = ["1d", "3d", "7d", "30d", "1y", "2y"].includes(req.body?.range) ? req.body.range : "1d";
    if (!raw) return res.status(400).json({ error: "tickers[] required" });
    const tickers = [
      ...new Set(
        raw
          .map((t) => (typeof t === "string" ? t.trim().toUpperCase() : ""))
          .filter((t) => /^[A-Z0-9.\-]{1,16}$/.test(t))
      ),
    ].slice(0, MAX_TICKERS_PER_CALL);

    const now = Date.now();
    const data = {};
    const failed = [];
    const toFetch = [];

    for (const t of tickers) {
      const key = `${t}::${range}`;
      const cached = HISTORY_CACHE.get(key);
      if (cached && now - cached.fetchedAt < HISTORY_TTL_MS) {
        data[t] = { points: cached.points, currency: cached.currency };
      } else {
        toFetch.push(t);
      }
    }

    await Promise.all(
      toFetch.map(async (t) => {
        try {
          const r = await fetchHistory(t, range);
          HISTORY_CACHE.set(`${t}::${range}`, { ...r, fetchedAt: now });
          data[t] = r;
        } catch (e) {
          failed.push(t);
        }
      })
    );

    res.json({ range, data, failed, cachedAt: now });
  } catch (err) {
    console.error("stocks-prices history error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
