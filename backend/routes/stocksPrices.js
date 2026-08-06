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

async function fetchOneYahoo(ticker) {
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
    return { price, currency: meta.currency || "USD", changePct, priorClose: prevClose };
  } finally {
    clearTimeout(tid);
  }
}

// Secondary source — FMP /stable/quote. Cross-checked against Yahoo below
// so a single feed hallucinating a wrong price can't poison the position
// book. Returns null (not throw) on any failure — we want to fall back
// gracefully to Yahoo-only when FMP is down or unconfigured, not surface
// noise to the caller.
async function fetchOneFmp(ticker) {
  const key = process.env.FMP_API_KEY || "";
  if (!key) return null;
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(ticker)}&apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : null;
    if (!row || !Number.isFinite(row.price) || row.price <= 0) return null;
    return {
      price: row.price,
      currency: row.currency || null, // FMP doesn't always report — Yahoo is authoritative here
      changePct: Number.isFinite(row.changesPercentage) ? row.changesPercentage : null,
      priorClose: Number.isFinite(row.previousClose) ? row.previousClose : null,
    };
  } catch { return null; } finally { clearTimeout(tid); }
}

// Dual-source price fetch with cross-check. Yahoo is the primary
// authoritative feed (has been for the whole project). FMP is the
// independent second opinion that catches the "Yahoo returned a wildly
// wrong number for a specific ticker" failure mode we hit with the
// NVDA-$42.55 / $43.65 sticky-corruption incidents.
//
// Cross-check logic:
//   • Both sources agree within 3% → return with confidence: "high"
//   • Disagree 3-10%             → return Yahoo's, confidence: "medium"
//   • Disagree >10%              → SUSPICIOUS: refuse to return a price
//     at all (throws "cross-check failed"). Client-side drift guard then
//     doesn't get to write anything, preserving whatever priceUsd was
//     stored before. Better a stale price than a confidently-wrong one.
//   • Only Yahoo returns          → confidence: "medium" (single-source)
//   • Only FMP returns            → confidence: "medium" (single-source)
//   • Neither returns             → throw, caller marks as failed
//
// The confidence tier is passed through to the frontend so the drift
// guard there can be smarter over time (e.g. "if confidence is high
// AND drift is <20%, always accept").
export async function fetchOne(ticker) {
  const [yahoo, fmp] = await Promise.all([
    fetchOneYahoo(ticker).catch(() => null),
    fetchOneFmp(ticker),
  ]);
  if (!yahoo && !fmp) throw new Error("no source returned a price");
  if (yahoo && !fmp) {
    return { ...yahoo, confidence: "medium", sources: ["yahoo"] };
  }
  if (!yahoo && fmp) {
    return { ...fmp, currency: fmp.currency || "USD", confidence: "medium", sources: ["fmp"] };
  }
  // Both sources returned — cross-check.
  const yp = yahoo.price;
  const fp = fmp.price;
  const disagreementPct = Math.abs(yp - fp) / Math.max(yp, fp);
  if (disagreementPct > 0.10) {
    console.warn(`[stocks-prices] ${ticker}: Yahoo=$${yp} vs FMP=$${fp} (${(disagreementPct * 100).toFixed(1)}% disagreement) — refusing to return a price`);
    throw new Error(`cross-check failed: yahoo=$${yp} vs fmp=$${fp}`);
  }
  const confidence = disagreementPct <= 0.03 ? "high" : "medium";
  if (confidence === "medium") {
    console.log(`[stocks-prices] ${ticker}: Yahoo=$${yp} vs FMP=$${fp} — medium confidence (${(disagreementPct * 100).toFixed(1)}% apart)`);
  }
  return {
    price: yp, // Yahoo remains the authoritative price value; FMP's role is verification.
    currency: yahoo.currency,
    changePct: yahoo.changePct,
    confidence,
    sources: ["yahoo", "fmp"],
    disagreementPct: Number((disagreementPct * 100).toFixed(2)),
  };
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
// POST /api/stocks-prices/day-change
//   Body: { tickers: [...] }   (max 50)
//   Resp: { data: { TICKER: { current, priorClose, changePct, currency } },
//           failed: [...] }
//
// Lightweight endpoint that returns just the day-change tuple. Used by the
// Positions view to render ▲/▼ trend arrows next to P/L%. Reuses the same
// 60s cache Map as the main /stocks-prices path (so a page that hits both
// endpoints doesn't double-fetch). Fail-open per-ticker — Yahoo hiccups
// leave the ticker in `failed` rather than breaking the whole batch.
// ─────────────────────────────────────────────────────────────────────
const DAYCHANGE_CACHE = new Map(); // ticker -> { current, priorClose, changePct, currency, fetchedAt }
const DAYCHANGE_TTL_MS = 60 * 1000;

router.post("/day-change", express.json({ limit: "16kb" }), async (req, res) => {
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
    const data = {};
    const failed = [];
    const toFetch = [];
    for (const t of tickers) {
      const c = DAYCHANGE_CACHE.get(t);
      if (c && now - c.fetchedAt < DAYCHANGE_TTL_MS) {
        data[t] = { current: c.current, priorClose: c.priorClose, changePct: c.changePct, currency: c.currency };
      } else {
        toFetch.push(t);
      }
    }
    await Promise.all(
      toFetch.map(async (t) => {
        try {
          // Yahoo-only path — FMP is redundant here since day-change is a
          // visual cue, not a book-writing operation. Skips the cross-check
          // cost for the same reason the /history endpoint does.
          const r = await fetchOneYahoo(t);
          const rec = {
            current: r.price,
            priorClose: r.priorClose ?? null,
            changePct: r.changePct ?? null,
            currency: r.currency || null,
            fetchedAt: now,
          };
          DAYCHANGE_CACHE.set(t, rec);
          data[t] = { current: rec.current, priorClose: rec.priorClose, changePct: rec.changePct, currency: rec.currency };
        } catch { failed.push(t); }
      })
    );
    res.json({ data, failed, cachedAt: now });
  } catch (err) {
    console.error("stocks-prices day-change error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/stocks-prices/premarket
//   Body: { tickers: [...] }   (max 50)
//   Resp: { data: {
//     TICKER: {
//       marketState,           // "PRE" | "REGULAR" | "POST" | "CLOSED" | "PREPRE"
//       regularPrice, regularChange, regularChangePct,
//       preMarketPrice, preMarketChange, preMarketChangePct, preMarketTime,
//       postMarketPrice, postMarketChange, postMarketChangePct, postMarketTime,
//       currency,
//     }, ...
//   }, failed: [...] }
//
// Yahoo's v7/finance/quote endpoint accepts a comma-separated symbols list
// and returns pre/post-market fields for tickers that trade extended hours
// (US-listed names). Cached 30s so a busy dashboard doesn't hammer Yahoo.
const PM_CACHE = new Map();
const PM_TTL_MS = 30 * 1000;

async function fetchPremarketBatch(tickers) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(","))}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Stocks Proxy)" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const rows = j?.quoteResponse?.result || [];
    const map = {};
    for (const q of rows) {
      const t = String(q.symbol || "").toUpperCase();
      map[t] = {
        marketState: q.marketState || "CLOSED",
        currency: q.currency || "USD",
        regularPrice: q.regularMarketPrice ?? null,
        regularChange: q.regularMarketChange ?? null,
        regularChangePct: q.regularMarketChangePercent ?? null,
        preMarketPrice: q.preMarketPrice ?? null,
        preMarketChange: q.preMarketChange ?? null,
        preMarketChangePct: q.preMarketChangePercent ?? null,
        preMarketTime: q.preMarketTime ? new Date(q.preMarketTime * 1000).toISOString() : null,
        postMarketPrice: q.postMarketPrice ?? null,
        postMarketChange: q.postMarketChange ?? null,
        postMarketChangePct: q.postMarketChangePercent ?? null,
        postMarketTime: q.postMarketTime ? new Date(q.postMarketTime * 1000).toISOString() : null,
      };
    }
    return map;
  } catch { return null; } finally { clearTimeout(tid); }
}

router.post("/premarket", express.json({ limit: "16kb" }), async (req, res) => {
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
    if (tickers.length === 0) return res.json({ data: {}, failed: [] });

    const now = Date.now();
    const data = {};
    const toFetch = [];
    for (const t of tickers) {
      const c = PM_CACHE.get(t);
      if (c && now - c.fetchedAt < PM_TTL_MS) data[t] = c.data;
      else toFetch.push(t);
    }
    if (toFetch.length > 0) {
      const fetched = await fetchPremarketBatch(toFetch);
      if (fetched) {
        for (const t of toFetch) {
          if (fetched[t]) {
            PM_CACHE.set(t, { data: fetched[t], fetchedAt: now });
            data[t] = fetched[t];
          }
        }
      }
    }
    const failed = tickers.filter((t) => !data[t]);
    res.json({ data, failed, cachedAt: now });
  } catch (err) {
    console.error("stocks-prices/premarket error:", err);
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
    case "1h":  return { range: "1d",  interval: "1m"  };
    case "4h":  return { range: "1d",  interval: "5m"  };
    case "1d":  return { range: "1d",  interval: "5m"  };
    case "3d":  return { range: "5d",  interval: "30m" };
    case "7d":  return { range: "5d",  interval: "60m" };
    case "30d": return { range: "1mo", interval: "1d"  };
    case "1y":  return { range: "1y",  interval: "1d"  };
    case "2y":  return { range: "2y",  interval: "1wk" };
    default:    return { range: "1mo", interval: "1d"  };
  }
}

// Trim the series to the last N calendar days (fractional for intraday)
function trimToRange(points, uiRange) {
  if (!points.length) return points;
  const lastT = points[points.length - 1].t;
  let days = 30;
  if (uiRange === "1h") days = 1 / 24 * 1.05; // ~1h with a small buffer
  else if (uiRange === "4h") days = 4 / 24 * 1.05;
  else if (uiRange === "1d") days = 1.1;
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
    // Whitelist mirrors the frontend range buttons in TickerPerformanceCard.
    // "1h" and "4h" were missing and silently coerced to "1d", so the two
    // shortest buttons broke silently. yahooRangeFor already handles both.
    const range = ["1h", "4h", "1d", "3d", "7d", "30d", "1y", "2y"].includes(req.body?.range) ? req.body.range : "1d";
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
