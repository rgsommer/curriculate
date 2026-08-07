// backend/services/stocksNews.js
//
// Portfolio-scoped news feed. Wraps FMP's stock_news + general_news
// endpoints with a modest in-memory cache. Used by the News tab
// (/api/stocks-news) to surface:
//   • per-ticker headlines for every held ticker (up to N recent items)
//   • portfolio-wide general market news
//
// Cost/quality note: FMP news is a rolling wire — for held names it
// beats Yahoo's noisier feed because it dedupes vendor cross-posts and
// includes a snippet. Cache is user-agnostic — same headlines regardless
// of who requests them, so we key by (ticker, limit) or "__general__".

import { isFmpEnabled } from "./fmpEnabled.js";

const NEWS_CACHE = new Map(); // key → { fetchedAt, data }
const NEWS_TTL_MS = 15 * 60 * 1000; // 15 minutes

function fmpKey() { return process.env.FMP_API_KEY || ""; }

function normalizeForFmp(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(".")) return t;
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

async function fmpFetch(path) {
  const key = fmpKey();
  if (!key) return null;
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(tid); }
}

// Normalize an FMP news row into the shape the frontend renders. Two
// FMP endpoints return slightly different field casings — this
// smooths them into one contract.
function normalizeItem(row) {
  if (!row || typeof row !== "object") return null;
  const title = row.title || row.headline || "";
  if (!title) return null;
  const url = row.url || row.link || "";
  const publisher = row.site || row.publisher || row.source || "";
  const publishedAt = row.publishedDate || row.date || row.pubDate || null;
  const snippet = String(row.text || row.summary || "").trim().slice(0, 400);
  const image = row.image || null;
  const symbol = row.symbol || row.ticker || null;
  return { title, url, publisher, publishedAt, snippet, image, symbol };
}

// Fetch per-ticker news. Returns up to `limit` items sorted newest first.
export async function getTickerNews(ticker, currency = "USD", { limit = 8 } = {}) {
  if (!isFmpEnabled() || !ticker) return [];
  const sym = normalizeForFmp(ticker, currency);
  const cacheKey = `sym:${sym}:${limit}`;
  const cached = NEWS_CACHE.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < NEWS_TTL_MS) return cached.data;
  // Prefer /stable then fall back to /api/v3 (same pattern as
  // stocksCatalystsFmp — different FMP tiers surface different paths).
  const rows =
    (await fmpFetch(`/stable/news/stock?symbols=${encodeURIComponent(sym)}&limit=${limit}`)) ||
    (await fmpFetch(`/api/v3/stock_news?tickers=${encodeURIComponent(sym)}&limit=${limit}`)) ||
    [];
  const items = (Array.isArray(rows) ? rows : []).map(normalizeItem).filter(Boolean).slice(0, limit);
  NEWS_CACHE.set(cacheKey, { fetchedAt: now, data: items });
  return items;
}

// Batch fetcher — parallel per-ticker fetches with a global concurrency
// cap so a 20-ticker portfolio doesn't spawn 20 simultaneous outbound
// requests. Returns a { TICKER: [item, ...] } map.
export async function getPortfolioTickerNews(positions, { perTickerLimit = 6, concurrency = 4 } = {}) {
  if (!Array.isArray(positions) || positions.length === 0) return {};
  const unique = [];
  const seen = new Set();
  for (const p of positions) {
    if (!p?.ticker || !(p.qty > 0)) continue;
    const key = `${p.ticker}|${p.ccy || "USD"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ticker: p.ticker, currency: p.ccy || "USD" });
  }
  const out = {};
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (i < unique.length) {
      const j = i++;
      const { ticker, currency } = unique[j];
      try {
        out[ticker] = await getTickerNews(ticker, currency, { limit: perTickerLimit });
      } catch { out[ticker] = []; }
    }
  });
  await Promise.all(workers);
  return out;
}

// General market news — one shared feed, cached 15min.
export async function getGeneralMarketNews({ limit = 20 } = {}) {
  if (!isFmpEnabled()) return [];
  const cacheKey = `__general__:${limit}`;
  const cached = NEWS_CACHE.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < NEWS_TTL_MS) return cached.data;
  const rows =
    (await fmpFetch(`/stable/news/general-latest?page=0&limit=${limit}`)) ||
    (await fmpFetch(`/api/v3/general_news?page=0`)) ||
    [];
  const items = (Array.isArray(rows) ? rows : []).map(normalizeItem).filter(Boolean).slice(0, limit);
  NEWS_CACHE.set(cacheKey, { fetchedAt: now, data: items });
  return items;
}
