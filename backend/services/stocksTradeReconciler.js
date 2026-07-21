// backend/services/stocksTradeReconciler.js
//
// Given a parsed broker alert + the user's portfolio/recs, decide:
//   1. Which account the trade belongs to (single-holder auto-match,
//      multi-holder → "needs review", zero-holder → default to
//      Non-Spousal for a fresh BUY or "needs review" for a fresh SELL)
//   2. Which open rec (if any) it fulfills (StocksAdviceRec or
//      StocksDailyPick within 30 days, matching ticker + action + price
//      within ±5% of entry)
//   3. Whether to auto-insert or flag for review
//
// Returns a plan the caller can apply. Deliberately doesn't touch the
// DB — testable in isolation, callable from dry-run endpoints.

import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDailyPick from "../models/StocksDailyPick.js";

const REC_LOOKBACK_DAYS = 30;
const PRICE_MATCH_TOLERANCE = 0.05; // ±5%

// Base ticker with exchange suffix stripped (RY.TO → RY) for matching
// alerts (which never carry a suffix) against positions (which may).
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "");
}

// Find account(s) currently holding a position in the given ticker.
// Returns the raw account list — caller decides how to interpret.
function accountsHoldingTicker(profile, ticker) {
  const base = baseTicker(ticker);
  const holdersById = new Map();
  for (const p of profile.positions || []) {
    if (baseTicker(p.ticker) !== base) continue;
    if (!(p.qty > 0)) continue;
    holdersById.set(p.acct, (holdersById.get(p.acct) || 0) + p.qty);
  }
  const out = [];
  for (const [id, qty] of holdersById.entries()) {
    const acct = (profile.accounts || []).find(a => a.id === id);
    if (acct) out.push({ id: acct.id, name: acct.name, sharesHeld: qty });
  }
  return out;
}

// Default account for a fresh BUY (no existing holding to infer from).
// Falls back to the first account named "Non-Spousal" or, failing that,
// the first account with matching-currency cash available. Last resort:
// null (caller flags "needs review").
function inferAccountForFreshBuy(profile, currency) {
  const nonSpousal = (profile.accounts || []).find(a =>
    /non.?spousal/i.test(a.name) && !/rrsp|tfsa|resp|fhsa/i.test(a.name)
  );
  if (nonSpousal) return { id: nonSpousal.id, name: nonSpousal.name };
  const cashKey = currency === "USD" ? "cashUsd" : "cashCad";
  const funded = (profile.accounts || []).find(a => (a[cashKey] || 0) > 100);
  if (funded) return { id: funded.id, name: funded.name };
  return null;
}

async function findMatchingOpenRec(email, alert) {
  const base = baseTicker(alert.ticker);
  const cutoff = new Date(Date.now() - REC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const [adviceRecs, dailyPicks] = await Promise.all([
    StocksAdviceRec.find({
      email,
      ticker: base,
      action: alert.action,
      status: "open",
      generatedAt: { $gte: cutoff },
    }).sort({ generatedAt: -1 }).lean(),
    StocksDailyPick.find({
      email,
      ticker: base,
      status: "open",
      pickDate: { $gte: cutoff },
    }).sort({ pickDate: -1 }).lean(),
  ]);

  const priceMatches = (target) => {
    if (!target || !alert.pricePerShare) return false;
    return Math.abs(alert.pricePerShare - target) / target <= PRICE_MATCH_TOLERANCE;
  };

  // Prefer the highest-conviction match: price-within-tolerance beats
  // "same ticker, wrong price"; adviceRec beats dailyPick (adviceRec has
  // an explicit action; dailyPick is BUY-only). Newest wins on ties.
  const withPriceMatch = adviceRecs.filter(r => priceMatches(r.entryPrice));
  if (withPriceMatch.length === 1) return { kind: "advice", rec: withPriceMatch[0], reason: "price-matched" };
  if (withPriceMatch.length > 1) return { kind: "advice", rec: withPriceMatch[0], reason: "price-matched-multi-newest" };

  // Daily picks are BUY-only. Only try them for BUY alerts.
  if (alert.action === "BUY") {
    const pickPriceMatches = dailyPicks.filter(p => priceMatches(p.entryPrice));
    if (pickPriceMatches.length === 1) return { kind: "daily-pick", rec: pickPriceMatches[0], reason: "price-matched" };
    if (pickPriceMatches.length > 1) return { kind: "daily-pick", rec: pickPriceMatches[0], reason: "price-matched-multi-newest" };
  }

  // No price match — fall back to the newest ticker-only match, but
  // return it as "loose" so the caller can flag needs-review.
  if (adviceRecs.length > 0) return { kind: "advice", rec: adviceRecs[0], reason: "ticker-only-loose" };
  if (alert.action === "BUY" && dailyPicks.length > 0) return { kind: "daily-pick", rec: dailyPicks[0], reason: "ticker-only-loose" };
  return null;
}

// Build the reconciliation plan. Never touches the DB — caller applies.
export async function planReconciliation({ email, profile, alert, occurredAt }) {
  if (!alert) return null;
  const holders = accountsHoldingTicker(profile, alert.ticker);

  let account = null;
  let accountReason = "";
  if (alert.action === "SELL") {
    if (holders.length === 1) {
      account = { id: holders[0].id, name: holders[0].name };
      accountReason = `single holder (${holders[0].sharesHeld} sh)`;
    } else if (holders.length === 0) {
      accountReason = "no account holds this ticker — needs review (short? typo? outside portfolio?)";
    } else {
      // Multiple accounts hold it. Auto-match if the alert qty matches
      // exactly ONE account's holding; else needs review.
      const exact = holders.filter(h => h.sharesHeld === alert.qty);
      if (exact.length === 1) {
        account = { id: exact[0].id, name: exact[0].name };
        accountReason = `only ${exact[0].name} holds exactly ${alert.qty} sh`;
      } else {
        accountReason = `${holders.length} accounts hold this ticker (${holders.map(h => `${h.name}=${h.sharesHeld}`).join(", ")}) — needs review`;
      }
    }
  } else if (alert.action === "BUY") {
    if (holders.length >= 1) {
      // Adding to existing position. Prefer the single-holder account.
      if (holders.length === 1) {
        account = { id: holders[0].id, name: holders[0].name };
        accountReason = `adding to existing position in ${holders[0].name}`;
      } else {
        accountReason = `${holders.length} accounts already hold this — needs review`;
      }
    } else {
      // Fresh BUY. Infer via the Non-Spousal default / funded account.
      const inferred = inferAccountForFreshBuy(profile, alert.currency);
      if (inferred) {
        account = inferred;
        accountReason = `fresh BUY → defaulted to ${inferred.name}`;
      } else {
        accountReason = "fresh BUY with no obvious account — needs review";
      }
    }
  }

  const linked = await findMatchingOpenRec(email, alert).catch(() => null);
  const loose = linked?.reason === "ticker-only-loose" || linked?.reason?.startsWith("price-matched-multi");
  const needsReview = !account || loose;

  return {
    account,
    accountReason,
    linked,
    status: needsReview ? "needs-review" : "auto",
    reviewReasons: [
      !account ? accountReason : null,
      loose ? `rec-link is loose (${linked.reason})` : null,
    ].filter(Boolean),
    occurredAt,
  };
}
