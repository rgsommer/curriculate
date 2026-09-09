// backend/services/stocksCatalystIngest.js
//
// P2.6 (2026-09-09) — hydrate the catalyst pipeline that P2.5 defined.
//
// P2.5 built the classifier + storage but the pick engine received no
// hydrated `catalystQualityScore` because nothing was persisting rows
// into StocksCatalystEvent. This module closes that gap.
//
// Sources today:
//   • FMP per-ticker news (stocksNews.getTickerNews) — primary
//   • SEC 8-K feed (stocks8K.get*) — canonical filings, higher trust
// A future source can plug in by satisfying the SourceItem shape:
//   { source, sourceId, ticker, eventDate, sourceDate, headline, url?, body? }
//
// Pipeline per ticker:
//   1. Fetch news + 8-K in parallel, both time-bounded.
//   2. Normalize into SourceItem shape with a canonical `dedupeKey`
//      = sha1(base-ticker + eventDate + normalized-headline-first-8-words).
//   3. Classify each with the deterministic classifier (P2.5).
//   4. Dedupe by dedupeKey. When two items share a key we PREFER
//      SEC 8-K > FMP-news (primary filing beats derivative coverage).
//   5. Persist survivors via persistCatalyst() (idempotent per
//      (ticker, source, sourceId)).
//   6. Aggregate a `catalystQualityScore` (0..1) for the pick engine
//      from the BEST MATERIAL catalyst in the last N days (default 21).
//      Category-weighted materiality mapped to 0..1. NEWS_NOISE never
//      contributes.

import crypto from "crypto";
import { getTickerNews } from "./stocksNews.js";
import { classifyCatalystItem, persistCatalyst, isMaterial } from "./stocksCatalystClassifier.js";
import StocksCatalystEvent from "../models/StocksCatalystEvent.js";

// Canonical dedupe key: same event described by many outlets should
// collapse to one row. Uses ticker + eventDate + first-8-word head.
export function dedupeKey({ ticker, eventDate, headline }) {
  const base = String(ticker || "").toUpperCase().replace(/\..*$/, "");
  const head = String(headline || "").toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return crypto.createHash("sha1").update(`${base}|${eventDate}|${head}`).digest("hex").slice(0, 16);
}

// Rank sources so dedupe preserves the higher-trust row.
const SOURCE_PRIORITY = { "sec-8k": 3, "sec": 3, "press-release": 2, "fmp-news": 1, "unknown": 0 };

function normalizeFmpNews(row, ticker) {
  const eventDate = String(row.publishedAt || row.publishedDate || "").slice(0, 10);
  if (!eventDate) return null;
  return {
    ticker,
    source: "fmp-news",
    sourceId: row.url || row.title,
    eventDate,
    sourceDate: eventDate,
    headline: row.title || row.headline || "",
    url: row.url || null,
    body: row.snippet || "",
  };
}

// Best-effort SEC 8-K adapter. Uses the existing feed if available.
async function fetchRecent8K(ticker) {
  try {
    const mod = await import("./stocks8K.js").catch(() => null);
    if (!mod) return [];
    // The existing module has various export names across the codebase;
    // try the common ones and just fall through if none are exposed.
    const fn = mod.getRecent8KsForTicker || mod.getRecent8Ks || mod.get8K || mod.default;
    if (typeof fn !== "function") return [];
    const rows = await fn(ticker).catch(() => []);
    return (Array.isArray(rows) ? rows : []).map(row => ({
      ticker,
      source: "sec-8k",
      sourceId: row.accessionNumber || row.link || row.filedAt || `${ticker}::${row.filedAt}`,
      eventDate: String(row.filedAt || row.date || "").slice(0, 10),
      sourceDate: String(row.filedAt || row.date || "").slice(0, 10),
      headline: (row.itemLabels && row.itemLabels[0]) || row.title || row.description || "8-K filing",
      url: row.linkToFilingDetails || row.link || null,
      body: (row.description || "").slice(0, 400),
    })).filter(x => x.eventDate);
  } catch { return []; }
}

// PUBLIC — hydrate catalyst events for one ticker. Returns an array
// of persisted survivor rows (post-dedupe) plus a computed
// catalystQualityScore in [0, 1].
export async function hydrateCatalystEventsForTicker(ticker, { lookbackDays = 21, maxNews = 12 } = {}) {
  if (!ticker) return { events: [], catalystQualityScore: null };
  const [newsRaw, fils] = await Promise.all([
    getTickerNews(ticker, "USD", { limit: maxNews }).catch(() => []),
    fetchRecent8K(ticker),
  ]);
  const cutoff = Date.now() - lookbackDays * 86400_000;
  const items = [
    ...newsRaw.map(n => normalizeFmpNews(n, ticker)).filter(Boolean),
    ...fils,
  ].filter(it => {
    const t = Date.parse(it.eventDate);
    return Number.isFinite(t) && t >= cutoff;
  });
  if (items.length === 0) return { events: [], catalystQualityScore: null };

  // Classify, then dedupe by canonical key preferring higher-priority source.
  const byKey = new Map(); // dedupeKey → { item, classified }
  for (const item of items) {
    const key = dedupeKey(item);
    const classified = classifyCatalystItem(item);
    const prior = byKey.get(key);
    if (!prior) { byKey.set(key, { key, item, classified }); continue; }
    const priorPri = SOURCE_PRIORITY[prior.item.source] ?? 0;
    const thisPri  = SOURCE_PRIORITY[item.source] ?? 0;
    if (thisPri > priorPri) byKey.set(key, { key, item, classified });
    // Equal priority: keep the higher-material one.
    else if (thisPri === priorPri && (classified.materialityScore || 0) > (prior.classified.materialityScore || 0)) {
      byKey.set(key, { key, item, classified });
    }
  }

  // Persist survivors. Fire-and-forget per row so a Mongo hiccup
  // never blocks the pick engine.
  const survivors = [...byKey.values()];
  await Promise.all(survivors.map(async ({ item, classified, key }) => {
    try {
      await persistCatalyst({ ...item, dedupeKey: key }, classified);
    } catch { /* soft-fail */ }
  }));

  // Aggregate: pick the BEST MATERIAL catalyst. If none material, score
  // is null (NOT 0 — null means "no material catalyst in window").
  const material = survivors.filter(s => isMaterial(s.classified));
  if (material.length === 0) return { events: survivors, catalystQualityScore: null, subtype: null };
  const best = material.reduce((a, b) => (a.classified.materialityScore >= b.classified.materialityScore ? a : b));
  const score = Math.max(0, Math.min(1, (best.classified.materialityScore || 0) / 100));
  return {
    events: survivors,
    materialCount: material.length,
    bestCategory: best.classified.category,
    bestMateriality: best.classified.materialityScore,
    catalystQualityScore: score,
  };
}

// PUBLIC — read persisted rows without refetching. Used by the pick
// engine's fast-path when we've already hydrated in a prior tick.
export async function loadRecentPersistedCatalysts(ticker, { lookbackDays = 21 } = {}) {
  if (!ticker) return [];
  const cutoff = new Date(Date.now() - lookbackDays * 86400_000).toISOString().slice(0, 10);
  try {
    const rows = await StocksCatalystEvent.find({
      ticker: String(ticker).toUpperCase(),
      eventDate: { $gte: cutoff },
    }).sort({ eventDate: -1 }).limit(20).lean();
    return rows || [];
  } catch { return []; }
}
