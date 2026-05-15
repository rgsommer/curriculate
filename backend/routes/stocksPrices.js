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

export default router;
