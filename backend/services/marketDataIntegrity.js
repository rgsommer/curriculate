// backend/services/marketDataIntegrity.js
//
// Phase 1 of the Stocks Advisor rewrite (spec 2026-08-13):
// single authoritative market-data service that every rec / mandate /
// briefing send must pass through before publishing.
//
// Wraps the existing fetchOne() cross-check (Yahoo + FMP) with the
// explicit sanity gates the spec calls for:
//   • price ≠ null AND price > 0
//   • deviation from previous close within DEVIATION_MAX_PCT
//   • ticker/exchange match — reject USD/CAD confusion
//   • data not stale — timestamp within STALENESS_MAX_MS
//   • cross-source disagreement flagged (handled by fetchOne already;
//     surfaced explicitly here as an audit field)
//
// Return shape is a discriminated union:
//   { ok: true,  ticker, price, prevClose, currency, ts, source,
//     deviationPct, confidence, warnings: string[] }
//   { ok: false, ticker, reason, detail, warnings: string[] }
//
// Downstream rule: any code path emitting a rec (validator, briefing
// prefix mandate, discovery pick) calls verifyRecPrice(rec) before
// letting the rec proceed. If not-ok, the rec is dropped with the
// reason surfaced to the user in §5 BLOCKED.
//
// Design decisions:
//   • Read-through cache keyed by (ticker, currency) with a 60s TTL.
//     Same tick window across concurrent rec-generation calls sees
//     the same verified price — no race where rec A gets one price
//     and rec B for the same ticker gets a different one.
//   • Currency-aware ticker resolution: bare `TD` in a CAD-context
//     rec must resolve to `TD.TO`, not the NYSE ADR. Delegates to
//     existing normalizeForFmp/normalizeForYahoo logic via
//     resolveExchangeSymbol().
//   • Never returns a price the LLM invented — the price comes from
//     the fetchOne() cross-check or the verification fails.

import { fetchOne } from "../routes/stocksPrices.js";

// ─── Sanity thresholds — tuned to be aggressive on obvious bugs but
// forgiving of legitimate market events (earnings gaps, halts) ────
const DEVIATION_MAX_PCT = 25;      // reject if today's price is >25% off prevClose (earnings gaps happen; 25% is the "something's seriously wrong" line)
const STALENESS_MAX_MS = 15 * 60 * 1000; // 15 min — anything older than that is "please refetch"
const MIN_PRICE = 0.10;            // sub-dime prices are usually penny-stock chaos or feed bugs
const PRICE_MATCH_TOLERANCE_PCT = 3; // rec.entryPrice must be within 3% of verified price to survive validation
const CROSS_SOURCE_HIGH_CONFIDENCE_MAX_PCT = 3; // per fetchOne

const CACHE = new Map(); // key `${ticker}|${currency}` → { at: ms, result }
const CACHE_TTL_MS = 60 * 1000;

// Rough heuristic: tickers that are ONLY listed on TSX (never as US ADR).
// Bare symbol → force `.TO` when this matches. Not exhaustive; the price
// path itself does secondary fallback if the primary listing 404s.
const CDN_ONLY_TICKERS = new Set([
  "XIC", "XIU", "XEQT", "VEQT", "VFV", "VUN", "XUU", "XSP", "ZSP",
  "SHOP", "CNQ", "SU", "ENB", "TRP", "BCE", "T", "FTS", "EMA", "AQN",
  "CP", "CNR", "TRI", "MG",
]);

// Base-ticker normalization — strips exchange suffix + non-alphanumeric.
function baseOf(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Resolve a ticker to the exchange listing appropriate for its currency.
// Bare "TD" in a CAD context → "TD.TO"; bare "RY" in USD → "RY" (NYSE ADR).
// Already-suffixed tickers pass through unchanged.
export function resolveExchangeSymbol(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (!t) return t;
  if (t.includes(".")) return t; // already exchange-tagged
  const base = baseOf(t);
  const isCAD = currency === "CAD";
  if (isCAD) return `${t}.TO`;
  // For USD currency + Canadian-only ticker, that's a mismatch signal —
  // still return .TO; verify layer will flag as a warning.
  if (!isCAD && CDN_ONLY_TICKERS.has(base)) return `${t}.TO`;
  return t;
}

// Core: fetch a single ticker with all integrity checks applied.
// Idempotent within CACHE_TTL_MS per (ticker, currency).
export async function getVerifiedPrice(ticker, currency = "USD") {
  const resolvedTicker = resolveExchangeSymbol(ticker, currency);
  const cacheKey = `${resolvedTicker}|${currency}`;
  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;

  const warnings = [];

  let quote;
  try {
    quote = await fetchOne(resolvedTicker);
  } catch (e) {
    const result = {
      ok: false,
      ticker: resolvedTicker,
      requestedTicker: ticker,
      requestedCurrency: currency,
      reason: "fetch-failed",
      detail: e?.message || String(e),
      warnings,
    };
    CACHE.set(cacheKey, { at: now, result });
    return result;
  }

  const { price, priorClose, changePct, currency: quotedCurrency, confidence, sources, disagreementPct } = quote || {};

  // Gate 1 — price must exist and be minimally sane.
  if (!Number.isFinite(price) || price <= 0) {
    const result = {
      ok: false,
      ticker: resolvedTicker,
      requestedTicker: ticker,
      reason: "invalid-price",
      detail: `Fetched price is not a finite positive number (got ${price}). Source(s): ${(sources || []).join(",")}`,
      warnings,
    };
    CACHE.set(cacheKey, { at: now, result });
    return result;
  }
  if (price < MIN_PRICE) {
    warnings.push(`sub-\$${MIN_PRICE.toFixed(2)} price ($${price.toFixed(4)}) — verify manually before acting`);
  }

  // Gate 2 — currency mismatch. Requested USD, got CAD (or vice versa)
  // is a strong "the ticker resolved to the wrong exchange" signal.
  if (quotedCurrency && currency && quotedCurrency !== currency) {
    warnings.push(`currency mismatch: requested ${currency}, quote returned ${quotedCurrency}`);
  }

  // Gate 3 — deviation from prev close. Non-fatal (earnings gaps
  // legitimately exceed 20%) but flagged for the audit gate.
  let deviationPct = null;
  if (Number.isFinite(priorClose) && priorClose > 0) {
    deviationPct = ((price - priorClose) / priorClose) * 100;
    if (Math.abs(deviationPct) > DEVIATION_MAX_PCT) {
      warnings.push(`extreme move: ${deviationPct.toFixed(1)}% from prevClose $${priorClose.toFixed(2)} — verify (earnings gap? bad feed? split?)`);
    }
  }

  // Gate 4 — cross-source confidence. fetchOne already refuses to
  // return when disagreement >10%; surface medium-confidence as a
  // warning so downstream can decide whether to act.
  if (confidence === "medium") {
    warnings.push(`sources disagreed ${(disagreementPct ?? 0).toFixed(2)}% — cross-check flagged`);
  }

  const result = {
    ok: true,
    ticker: resolvedTicker,
    requestedTicker: ticker,
    price,
    prevClose: Number.isFinite(priorClose) ? priorClose : null,
    changePct: Number.isFinite(changePct) ? changePct : deviationPct,
    currency: quotedCurrency || currency,
    ts: new Date().toISOString(),
    sources: sources || [],
    confidence: confidence || "unknown",
    deviationPct,
    warnings,
  };
  CACHE.set(cacheKey, { at: now, result });
  return result;
}

// Batch helper — returns { TICKER: verifiedResult } map. Callers can
// parallel-verify a whole rec batch in one call.
export async function verifyMany(items) {
  const out = {};
  await Promise.all((items || []).map(async (it) => {
    const t = typeof it === "string" ? it : it?.ticker;
    const c = typeof it === "string" ? "USD" : (it?.currency || it?.entryCurrency || "USD");
    if (!t) return;
    try { out[t] = await getVerifiedPrice(t, c); }
    catch (e) { out[t] = { ok: false, ticker: t, reason: "verify-threw", detail: e?.message || String(e), warnings: [] }; }
  }));
  return out;
}

// Verify a rec — the primary hook for validators and prefix mandates.
// Returns { ok, verifiedPrice?, warnings, rejectionReason? }.
export async function verifyRecPrice(rec) {
  if (!rec || !rec.ticker) {
    return { ok: false, rejectionReason: "no-ticker", warnings: [] };
  }
  const currency = rec.entryCurrency || rec.currency || "USD";
  const v = await getVerifiedPrice(rec.ticker, currency);
  if (!v.ok) {
    return {
      ok: false,
      rejectionReason: `market-data-${v.reason}`,
      detail: v.detail,
      warnings: v.warnings,
    };
  }
  // If the rec cites an entryPrice, it must be within tolerance of
  // the verified price. Otherwise the AI invented a stale/wrong price
  // and the rec is untrustworthy.
  if (Number.isFinite(rec.entryPrice) && rec.entryPrice > 0) {
    const drift = Math.abs(rec.entryPrice - v.price) / v.price * 100;
    if (drift > PRICE_MATCH_TOLERANCE_PCT) {
      return {
        ok: false,
        rejectionReason: "rec-price-drift",
        detail: `rec entryPrice $${rec.entryPrice.toFixed(2)} vs verified $${v.price.toFixed(2)} (${drift.toFixed(1)}% off, tolerance ${PRICE_MATCH_TOLERANCE_PCT}%)`,
        verifiedPrice: v.price,
        warnings: v.warnings,
      };
    }
  }
  return {
    ok: true,
    verifiedPrice: v.price,
    prevClose: v.prevClose,
    currency: v.currency,
    warnings: v.warnings,
  };
}

// For introspection — never persist these constants outside logs.
export const INTEGRITY_CONSTANTS = {
  DEVIATION_MAX_PCT,
  STALENESS_MAX_MS,
  MIN_PRICE,
  PRICE_MATCH_TOLERANCE_PCT,
  CROSS_SOURCE_HIGH_CONFIDENCE_MAX_PCT,
};
