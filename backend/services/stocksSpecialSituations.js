// backend/services/stocksSpecialSituations.js
//
// Special-situation / corporate-action awareness for the pick engine.
//
// Two producers feed one store:
//   1. FMP /mergers-acquisitions-rss (fresh feed of announced deals)
//      + /dealsAndSpinoffs (structured detail record when available)
//   2. Existing StocksEightK docs — Item "1.01" (Material Definitive
//      Agreement) is already tagged highSignal in that model; here we
//      READ it as an authoritative signal that this issuer is party to
//      a definitive corporate agreement.
//
// One consumer contract for downstream code:
//   getSpecialSituationForTicker(ticker) →
//     { active, kind, status, acquirer, cashPerShare, stockRatio,
//       impliedDealValue, announcedAt, expectedClose, confidence,
//       source, sourceUrl }
//   or null.
//
// Anything that treats the return as GATE input must check `active`.
// Anything that displays terms must check that ProvenancedNumbers have
// non-null `.value` — a missing term is not zero, it's UNKNOWN, and
// downstream code must fail-closed (SCREENED) rather than assume 0.
//
// This module NEVER trusts a scraped acquirer share price. When a mixed
// (cash+stock) deal is priced, computeImpliedDealValue independently
// calls verifyRecPrice on the acquirer's ticker — the same integrity
// layer that gates every rec price in the briefing.

import mongoose from "mongoose";
import StocksSpecialSituation, {
  SPECIAL_SITUATION_KINDS,
  SPECIAL_SITUATION_STATUSES,
} from "../models/StocksSpecialSituation.js";
import StocksEightK from "../models/StocksEightK.js";
import { verifyRecPrice } from "./marketDataIntegrity.js";
import { isFmpEnabled } from "./fmpEnabled.js";

const FMP_HOST = "https://financialmodelingprep.com";
const FMP_TIMEOUT_MS = 7000;
// Deal records go stale — a definitive agreement 400 days old with no
// status update is either done, dead, or forgotten. Refresh cutoff for
// re-poll = 30d; auto-EXPIRED when > 400d and still ANNOUNCED/PENDING.
const STALE_ANNOUNCEMENT_DAYS = 400;

function fmpKey() { return process.env.FMP_API_KEY || ""; }

async function fmpGet(path) {
  const key = fmpKey();
  if (!key) return null;
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FMP_HOST}${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), FMP_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(tid); }
}

// ─── dealKey ─────────────────────────────────────────────────────
// A stable per-deal identifier so idempotent upserts don't create
// duplicate rows on republish. Amendments with the same parties keep
// the same key; a new deal on the same ticker mints a new key.
function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
}
function buildDealKey({ source, target, acquirer, announcedAt }) {
  const d = announcedAt ? new Date(announcedAt).toISOString().slice(0, 10) : "unknown";
  return [source || "unknown", normalizeText(target), normalizeText(acquirer), d]
    .filter(Boolean).join(":");
}

// ─── FMP adapter #1 — recent M&A RSS ─────────────────────────────
// FMP's /stable/mergers-acquisitions-rss (fallback /api/v4/mergers-acquisitions-rss-feed)
// returns recent deal-announcement rows. Shape is provider-specific and
// occasionally changes; we're defensive about every field.
async function fetchFmpMaRss({ limit = 200 } = {}) {
  if (!isFmpEnabled()) return [];
  const arr = await fmpGet(`/stable/mergers-acquisitions-latest?limit=${limit}`)
    || await fmpGet(`/api/v4/mergers-acquisitions-rss-feed?limit=${limit}`)
    || [];
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const targetTicker = String(row.symbol || row.targetedSymbol || row.targetSymbol || "").toUpperCase();
    if (!targetTicker) continue;
    const announcedAt = row.transactionDate || row.acceptedDate || row.publishedDate || row.date || null;
    out.push({
      ticker: targetTicker,
      exchange: row.exchange || null,
      currency: row.currency || null,
      kind: "MERGER_TARGET",
      status: "ANNOUNCED",
      acquirer: row.acquiringCompanyName || row.acquirerName || row.companyName || row.acquirer || null,
      acquirerTicker: String(row.acquiringSymbol || row.acquirerSymbol || "").toUpperCase() || null,
      target: row.targetedCompanyName || row.targetCompanyName || row.targetName || null,
      cashPerShare: null,   // rarely present on the RSS row
      stockRatio: null,
      announcedAt: announcedAt ? new Date(announcedAt) : null,
      source: "FMP_MA_RSS",
      sourceUrl: row.link || row.url || null,
      sourceHeadline: row.title || row.headline || null,
      confidence: 0.5,
    });
  }
  return out;
}

// ─── FMP adapter #2 — deals & spinoffs detail ────────────────────
// The structured record (when available) has consideration terms.
async function fetchFmpDealDetail(ticker) {
  if (!isFmpEnabled() || !ticker) return null;
  const arr = await fmpGet(`/stable/mergers-acquisitions?symbol=${encodeURIComponent(ticker)}`)
    || await fmpGet(`/api/v4/mergers-acquisitions/${encodeURIComponent(ticker)}`)
    || null;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // Newest first — take the most-recent record. FMP's own ordering is
  // usually newest-first but sort defensively.
  const rows = arr
    .map(r => ({ ...r, _dt: r.transactionDate || r.publishedDate || r.date || null }))
    .sort((a, b) => (new Date(b._dt || 0)) - (new Date(a._dt || 0)));
  const r = rows[0];
  return {
    kind: "MERGER_TARGET",
    status: statusFromFmp(r) || "ANNOUNCED",
    acquirer: r.acquiringCompanyName || r.acquirerName || null,
    acquirerTicker: String(r.acquiringSymbol || r.acquirerSymbol || "").toUpperCase() || null,
    target: r.targetedCompanyName || r.targetCompanyName || null,
    cashPerShare: Number.isFinite(+r.cashPerShare) && +r.cashPerShare > 0
      ? { value: +r.cashPerShare, unit: r.currency || "USD", currency: r.currency || "USD", asOf: r._dt ? new Date(r._dt) : null, source: "FMP_DEALS", sourceType: "FMP_DEALS" }
      : null,
    stockRatio: Number.isFinite(+r.exchangeRatio) && +r.exchangeRatio > 0
      ? { value: +r.exchangeRatio, unit: "shares_per_share", currency: null, asOf: r._dt ? new Date(r._dt) : null, source: "FMP_DEALS", sourceType: "FMP_DEALS" }
      : null,
    announcedAt: r._dt ? new Date(r._dt) : null,
    expectedClose: r.expectedClose ? new Date(r.expectedClose) : null,
    source: "FMP_DEALS",
    sourceUrl: r.link || r.url || null,
    sourceHeadline: r.title || r.headline || null,
    confidence: 0.8,
  };
}

function statusFromFmp(r) {
  const s = String(r.status || r.dealStatus || "").toUpperCase();
  if (s.includes("COMPLET") || s.includes("CLOSED")) return "COMPLETED";
  if (s.includes("TERMIN") || s.includes("WITHDRAWN")) return "TERMINATED";
  if (s.includes("APPROV")) return "APPROVED";
  if (s.includes("AMEND")) return "AMENDED";
  if (s.includes("PEND") || s.includes("PROGRESS")) return "PENDING";
  return null;
}

// ─── Reader #3 — SEC 8-K Item 1.01 ───────────────────────────────
// Item 1.01 = "Entry into a Material Definitive Agreement". Very high
// signal but does NOT by itself tell us the deal is an acquisition —
// it could be a loan agreement, a supply contract, etc. Treat it as
// confidence 0.9 evidence of *some* material deal; the FMP feed
// distinguishes M&A specifically. When both fire on the same ticker
// within 30 days, the composite confidence goes to 1.0.
async function readEightKItem101Signals({ sinceDays = 90, tickers = null } = {}) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const query = { itemNumbers: "1.01", filedAt: { $gte: since } };
  if (Array.isArray(tickers) && tickers.length > 0) {
    query.ticker = { $in: tickers.map(t => String(t || "").toUpperCase()) };
  }
  try {
    const rows = await StocksEightK.find(query)
      .select({ ticker: 1, filedAt: 1, itemNumbers: 1, primaryDocument: 1, url: 1, accessionNumber: 1 })
      .sort({ filedAt: -1 })
      .limit(500)
      .lean();
    return rows.map(r => ({
      ticker: String(r.ticker).toUpperCase(),
      announcedAt: r.filedAt,
      source: "SEC_8K_1_01",
      sourceUrl: r.url,
      sourceHeadline: `SEC 8-K Item 1.01 (Material Definitive Agreement) — accession ${r.accessionNumber}`,
      accessionNumber: r.accessionNumber,
      confidence: 0.9,
    }));
  } catch (e) {
    console.warn("[special-situations] 8-K reader failed:", e?.message);
    return [];
  }
}

// ─── computeImpliedDealValue ─────────────────────────────────────
// For cash+stock or stock-only deals, we independently price-verify
// the acquirer via the same market-data integrity layer that gates
// every rec price. NEVER trust a scraped acquirer price.
//
// Returns { impliedValue, currency, brokenReason? }. brokenReason
// non-null → the deal has consideration terms we cannot price today;
// downstream code must fail-closed (SCREENED — MISSING TERMS), not
// invent an arbitrage spread.
export async function computeImpliedDealValue(situation, opts = {}) {
  if (!situation) return { impliedValue: null, brokenReason: "no-situation" };
  const cash = situation.cashPerShare?.value;
  const ratio = situation.stockRatio?.value;
  const acquirerTicker = situation.acquirerTicker;
  const currency = situation.cashPerShare?.currency || situation.currency || "USD";
  // Injectable verifier for tests. Production defaults to the market-data
  // integrity layer's verifyRecPrice — the same function that gates every
  // rec price in the briefing. Never trust a scraped acquirer price.
  const verify = opts.verifyPrice || verifyRecPrice;

  // Cash-only
  if (Number.isFinite(cash) && cash > 0 && !(Number.isFinite(ratio) && ratio > 0)) {
    return { impliedValue: cash, currency, verifiedAcquirerPrice: null };
  }
  // Stock-required — must verify acquirer price
  if (Number.isFinite(ratio) && ratio > 0) {
    if (!acquirerTicker) {
      return { impliedValue: null, brokenReason: "stock-deal-no-acquirer-ticker" };
    }
    const v = await verify({ ticker: acquirerTicker, entryCurrency: currency });
    if (!v.ok || !Number.isFinite(v.verifiedPrice) || v.verifiedPrice <= 0) {
      return {
        impliedValue: null,
        brokenReason: `acquirer-price-unverifiable:${v.rejectionReason || "unknown"}`,
      };
    }
    const stockValue = v.verifiedPrice * ratio;
    const implied = (Number.isFinite(cash) && cash > 0) ? cash + stockValue : stockValue;
    return { impliedValue: implied, currency, verifiedAcquirerPrice: v.verifiedPrice };
  }
  // No consideration terms known
  return { impliedValue: null, brokenReason: "no-consideration-terms" };
}

// ─── getSpecialSituationForTicker ────────────────────────────────
// The one function the pick engine and daily briefing call. Returns
// null when there is no active special situation. When active, the
// returned object is the store row plus a computed `impliedDealValue`
// block from the price-verified acquirer (for stock/mixed deals).
export async function getSpecialSituationForTicker(ticker) {
  if (!ticker) return null;
  const t = String(ticker).toUpperCase();
  let row;
  try {
    row = await StocksSpecialSituation.findOne({ ticker: t, active: true })
      .sort({ announcedAt: -1 })
      .lean();
  } catch (e) {
    console.warn(`[special-situations] lookup failed for ${t}:`, e?.message);
    return null;
  }
  if (!row) return null;
  let impliedDealValue = null;
  try { impliedDealValue = await computeImpliedDealValue(row); } catch { impliedDealValue = null; }
  return { ...row, impliedDealValue };
}

// ─── Persistence ─────────────────────────────────────────────────
// Idempotent upsert. Composite unique index (ticker, dealKey) means
// two calls with identical params produce one doc. $setOnInsert
// preserves the ORIGINAL announcedAt / discovery timestamp so a
// republish 30 days later doesn't rewrite history.
export async function persistSpecialSituations(candidates = []) {
  const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  for (const c of candidates) {
    if (!c?.ticker || !c?.kind || !c?.status) { results.skipped++; continue; }
    const dealKey = c.dealKey || buildDealKey(c);
    const active = !["COMPLETED", "TERMINATED", "EXPIRED"].includes(c.status);
    const expiresAt = active ? null : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    try {
      const filter = { ticker: c.ticker, dealKey };
      const setOnInsert = {
        announcedAt: c.announcedAt || new Date(),
        createdAt: new Date(),
      };
      // On update we refresh mutable fields (status, terms if the row
      // gained better data, expectedClose, lastUpdatedAt, expiresAt)
      // but NEVER announcedAt / createdAt — those are frozen at first
      // observation. The confidence field is max-monotone: once a
      // definitive 8-K raises it to 0.9+, an RSS re-mention cannot lower it.
      const $set = {
        exchange: c.exchange || null,
        currency: c.currency || null,
        kind: c.kind,
        status: c.status,
        active,
        acquirer: c.acquirer || null,
        acquirerTicker: c.acquirerTicker || null,
        target: c.target || null,
        expectedClose: c.expectedClose || null,
        lastUpdatedAt: new Date(),
        source: c.source || null,
        sourceUrl: c.sourceUrl || null,
        sourceHeadline: c.sourceHeadline || null,
        expiresAt,
      };
      if (c.cashPerShare) $set.cashPerShare = c.cashPerShare;
      if (c.stockRatio) $set.stockRatio = c.stockRatio;
      // Fetch existing to compute max-monotone confidence.
      const existing = await StocksSpecialSituation.findOne(filter).select({ confidence: 1 }).lean();
      const nextConfidence = Math.max(Number(existing?.confidence) || 0, Number(c.confidence) || 0);
      $set.confidence = nextConfidence;
      const r = await StocksSpecialSituation.updateOne(
        filter,
        { $set, $setOnInsert: setOnInsert },
        { upsert: true }
      );
      if (r.upsertedCount > 0) results.inserted++;
      else if (r.modifiedCount > 0) results.updated++;
      else results.skipped++;
    } catch (e) {
      results.errors.push({ ticker: c.ticker, error: e?.message || String(e) });
    }
  }
  return results;
}

// ─── Daily sync ──────────────────────────────────────────────────
// Called by the 06:00 ET poll cron. Refreshes the store from all
// producers, then walks stale ANNOUNCED/PENDING rows and auto-EXPIREs
// anything older than STALE_ANNOUNCEMENT_DAYS (no upstream update in
// 400+ days is presumed dead).
export async function syncSpecialSituationsForUniverse({ tickers = null } = {}) {
  const start = Date.now();
  const summary = { rssRows: 0, detailRows: 0, eightKRows: 0, inserted: 0, updated: 0, expired: 0, errors: 0 };

  // 1) RSS feed — broad discovery, low confidence
  let rssRows = [];
  try { rssRows = await fetchFmpMaRss({ limit: 200 }); }
  catch (e) { summary.errors++; console.warn("[special-situations] RSS failed:", e?.message); }
  summary.rssRows = rssRows.length;

  // 2) 8-K Item 1.01 backfill — high-confidence "definitive agreement"
  let eightKRows = [];
  try { eightKRows = await readEightKItem101Signals({ sinceDays: 120, tickers }); }
  catch (e) { summary.errors++; console.warn("[special-situations] 8-K read failed:", e?.message); }
  summary.eightKRows = eightKRows.length;

  // 3) Union tickers we care about — RSS + 8-K + explicit input list
  const targetTickers = new Set();
  for (const r of rssRows) targetTickers.add(r.ticker);
  for (const r of eightKRows) targetTickers.add(r.ticker);
  for (const t of (tickers || [])) targetTickers.add(String(t).toUpperCase());

  // 4) Fetch detail for each — cap concurrency to avoid FMP burst
  const CONC = 3;
  const detailByTicker = new Map();
  const targetList = [...targetTickers];
  for (let i = 0; i < targetList.length; i += CONC) {
    const slice = targetList.slice(i, i + CONC);
    await Promise.all(slice.map(async (t) => {
      try {
        const d = await fetchFmpDealDetail(t);
        if (d) { detailByTicker.set(t, d); summary.detailRows++; }
      } catch (e) { summary.errors++; }
    }));
  }

  // 5) Merge — for each candidate ticker, produce ONE persistent row
  // by folding the highest-confidence source over the others.
  const merged = [];
  for (const ticker of targetTickers) {
    const rssHit = rssRows.find(r => r.ticker === ticker);
    const eightKHit = eightKRows.find(r => r.ticker === ticker);
    const detail = detailByTicker.get(ticker);
    // Prefer detail (has terms), fall back to RSS, always merge 8-K
    // confidence bump when the same ticker also has a definitive filing.
    const base = detail || rssHit;
    if (!base) continue;
    const merged1 = {
      ...base,
      ticker,
      confidence: Math.max(base.confidence || 0, eightKHit ? 1.0 : 0),
    };
    merged1.dealKey = buildDealKey(merged1);
    merged.push(merged1);
  }

  // 6) Persist
  const persistResult = await persistSpecialSituations(merged);
  summary.inserted = persistResult.inserted;
  summary.updated = persistResult.updated;

  // 7) Expire stale rows — anything ANNOUNCED/PENDING with
  // announcedAt older than STALE_ANNOUNCEMENT_DAYS.
  try {
    const cutoff = new Date(Date.now() - STALE_ANNOUNCEMENT_DAYS * 24 * 60 * 60 * 1000);
    const r = await StocksSpecialSituation.updateMany(
      { active: true, status: { $in: ["ANNOUNCED", "PENDING"] }, announcedAt: { $lt: cutoff } },
      { $set: { status: "EXPIRED", active: false, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } }
    );
    summary.expired = r.modifiedCount || 0;
  } catch (e) {
    console.warn("[special-situations] stale sweep failed:", e?.message);
  }

  summary.elapsedMs = Date.now() - start;
  return summary;
}

// ─── Format helpers for the briefing renderer ────────────────────
// The renderer decides tier ("SCREENED — ACTIVE M&A" vs "EVENT-DRIVEN
// ANALYSIS") based on whether we can PRICE the deal. This helper
// returns the display block for the pick line — arbitrage spread,
// expected close, verified acquirer price when applicable, and every
// term provenance-tagged so the operator can trace numbers.
export function formatSpecialSituationBlock(sit, ctx = {}) {
  if (!sit) return null;
  const kindLabel = sit.kind === "MERGER_TARGET" ? "M&A target"
    : sit.kind === "TENDER_OFFER" ? "tender offer"
    : sit.kind === "GOING_PRIVATE" ? "take-private"
    : sit.kind === "SPINOFF" ? "spin-off"
    : sit.kind;
  const parts = [];
  parts.push(`⚠ SPECIAL SITUATION — ${kindLabel} · status ${sit.status} · confidence ${(sit.confidence * 100).toFixed(0)}%`);
  if (sit.acquirer) parts.push(`   acquirer: ${sit.acquirer}${sit.acquirerTicker ? ` (${sit.acquirerTicker})` : ""}`);
  const terms = [];
  if (sit.cashPerShare?.value) terms.push(`$${sit.cashPerShare.value.toFixed(2)} ${sit.cashPerShare.currency || ""} cash/share`);
  if (sit.stockRatio?.value) terms.push(`${sit.stockRatio.value.toFixed(4)} acquirer sh/target sh`);
  if (terms.length > 0) parts.push(`   consideration: ${terms.join(" + ")}`);
  const iv = sit.impliedDealValue;
  if (iv && Number.isFinite(iv.impliedValue)) {
    parts.push(`   implied deal value: $${iv.impliedValue.toFixed(2)} ${iv.currency || ""}${iv.verifiedAcquirerPrice ? ` (acquirer price verified @ $${iv.verifiedAcquirerPrice.toFixed(2)})` : ""}`);
    if (Number.isFinite(ctx.livePrice) && ctx.livePrice > 0) {
      const spreadPct = ((iv.impliedValue - ctx.livePrice) / ctx.livePrice) * 100;
      parts.push(`   spread vs live $${ctx.livePrice.toFixed(2)}: ${spreadPct >= 0 ? "+" : ""}${spreadPct.toFixed(1)}%`);
    }
  } else if (iv?.brokenReason) {
    parts.push(`   deal value: UNKNOWN (${iv.brokenReason}) — SCREENED, cannot price`);
  }
  if (sit.expectedClose) parts.push(`   expected close: ${new Date(sit.expectedClose).toISOString().slice(0, 10)}`);
  if (sit.announcedAt) parts.push(`   announced: ${new Date(sit.announcedAt).toISOString().slice(0, 10)}`);
  if (sit.source) parts.push(`   source: ${sit.source}${sit.sourceUrl ? ` — ${sit.sourceUrl}` : ""}`);
  return parts.join("\n");
}

// Introspection for tests + diagnostics — returns whether this deal
// has enough verifiable terms to compute an arbitrage spread, or is
// a stub that must fail-closed. Distinct from `active` (which is only
// about the pick-engine preflight gate).
export function isDealPriceable(sit) {
  if (!sit) return false;
  const cash = sit.cashPerShare?.value;
  const ratio = sit.stockRatio?.value;
  if (Number.isFinite(cash) && cash > 0 && !(Number.isFinite(ratio) && ratio > 0)) return true;
  if (Number.isFinite(ratio) && ratio > 0 && sit.acquirerTicker) return true;
  return false;
}

// Introspection — for /briefing-diagnostics.
export async function getActiveSpecialSituations({ limit = 50 } = {}) {
  try {
    return await StocksSpecialSituation.find({ active: true })
      .sort({ announcedAt: -1 })
      .limit(limit)
      .lean();
  } catch { return []; }
}

export {
  SPECIAL_SITUATION_KINDS,
  SPECIAL_SITUATION_STATUSES,
  buildDealKey,
};
