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
import StocksTradeJournal from "../models/StocksTradeJournal.js";

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
//
// Currency-aware ranking: pick the account whose matching-currency cash
// is highest, since that's the account that actually has the money to
// fund the buy. Non-Spousal is preferred only when CAD-account funding
// is tied — the previous "always Non-Spousal first" default silently
// misfiled every fresh CAD-listing buy (XIU, XIC, VFV, etc.) into
// Non-Spousal USD, which was the root cause of the +284 XIU / −$14,861
// USD mess.
//
// Returns null when nothing has meaningful matching-currency cash;
// caller flags "needs review" rather than force a wrong default.
function inferAccountForFreshBuy(profile, currency) {
  const cashKey = currency === "USD" ? "cashUsd" : "cashCad";
  const candidates = (profile.accounts || [])
    .map(a => ({ a, cash: a[cashKey] || 0 }))
    .filter(x => x.cash > 100)
    .sort((x, y) => y.cash - x.cash);
  if (candidates.length === 0) return null;
  // Prefer whichever has the most matching-currency cash. Ties broken
  // by Non-Spousal (for CAD ties this keeps existing behavior on the
  // Non-Spousal cash sleeve; for USD ties same).
  const top = candidates[0];
  const secondHasSameCash = candidates[1] && Math.abs(candidates[1].cash - top.cash) < 100;
  if (secondHasSameCash) {
    const nonSpousalTop = candidates.find(x =>
      /non.?spousal/i.test(x.a.name) && !/rrsp|tfsa|resp|fhsa/i.test(x.a.name)
    );
    if (nonSpousalTop) return { id: nonSpousalTop.a.id, name: nonSpousalTop.a.name };
  }
  return { id: top.a.id, name: top.a.name };
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

// For an ambiguous SELL (multiple accounts hold the ticker, none matches
// alert qty exactly), find the account with the most recent BUY of the
// same base ticker within the last 90 days. That's where the tax lots
// being sold most likely came from — swing traders sell OUT of the same
// account they bought INTO. Returns { id, name } or null.
async function inferAccountFromRecentBuys(email, profile, ticker) {
  const base = baseTicker(ticker);
  const cutoff = new Date(Date.now() - 90 * 86400000);
  const trades = await StocksTradeJournal.find({
    email,
    executedAt: { $gte: cutoff },
    "legs.side": "BUY",
    account: { $ne: "" },
  }).sort({ executedAt: -1 }).lean();
  for (const t of trades) {
    const hasTicker = (t.legs || []).some(leg =>
      leg.side === "BUY" && baseTicker(leg.ticker) === base
    );
    if (hasTicker && t.account) {
      const acct = (profile.accounts || []).find(a => a.id === t.account);
      if (acct) return { id: acct.id, name: acct.name, recentBuyAt: t.executedAt };
    }
  }
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
      // Multiple accounts hold it. Try three fallbacks in order:
      //   1. Exactly one holds the alert qty → that account
      //   2. Only one has enough shares to cover the alert → that account
      //   3. Look at recent BUY history — the account with the most
      //      recent BUY on this ticker is where the tax lots being sold
      //      most likely originated (swing pattern: SELL out of the same
      //      account we bought INTO)
      const exact = holders.filter(h => h.sharesHeld === alert.qty);
      const enough = holders.filter(h => h.sharesHeld >= alert.qty);
      if (exact.length === 1) {
        account = { id: exact[0].id, name: exact[0].name };
        accountReason = `only ${exact[0].name} holds exactly ${alert.qty} sh`;
      } else if (enough.length === 1) {
        account = { id: enough[0].id, name: enough[0].name };
        accountReason = `only ${enough[0].name} has enough (${enough[0].sharesHeld} sh) to cover the ${alert.qty}-sh SELL`;
      } else {
        const buyMatch = await inferAccountFromRecentBuys(email, profile, alert.ticker).catch(() => null);
        if (buyMatch && holders.some(h => h.id === buyMatch.id)) {
          account = { id: buyMatch.id, name: buyMatch.name };
          accountReason = `most recent BUY of ${alert.ticker} was in ${buyMatch.name} on ${new Date(buyMatch.recentBuyAt).toISOString().slice(0, 10)} — swing exit`;
        } else {
          accountReason = `${holders.length} accounts hold this ticker (${holders.map(h => `${h.name}=${h.sharesHeld}`).join(", ")}) — needs review`;
        }
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
