// backend/services/stocksTradeApplier.js
//
// The shared mutation core for adding a trade to a user's portfolio.
// Extracted from routes/stocksTrade.js so the Gmail poller (and any
// future broker integrations) apply trades through the SAME logic the
// manual "Record trade" modal uses. Without this shared path, an
// auto-reconciled SELL leaves the position qty stale on the Dashboard,
// which is exactly the "silent" bug we found the day after Phase 2B
// went live.
//
// Contract:
//   applyReconciledTrade({
//     email,          // user email
//     legs,           // normalized legs (side, ticker, shares, pricePerShare, currency, grossValue)
//     accountId,      // portfolio.accounts[].id — where the trade lands
//     executedAt,     // Date the broker filed
//     notes,          // optional short note stored on the journal doc
//     linkedAdviceRecId,   // optional ObjectId of the linked advice rec
//     linkedDailyPickId,   // optional ObjectId of the linked daily pick
//     brokerReconcileKey,  // dedup key from the poller (see stocksCibcParser)
//     brokerReconcileSource,
//     brokerReconcileStatus,   // "auto" | "needs-review"
//     brokerReconcileNotes,    // human-readable reasoning
//   }) →
//     { trade, portfolio }  on success
//     throws Error           on validation failure (unknown account,
//                            over-sell, etc). Caller decides how to
//                            surface / retry.
//
// Does NOT talk to the broker or the mailbox — that's the poller's job.
// Does NOT decide account or rec linkage — that's the reconciler's job.
// Just applies the plan.

import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { bumpPyramidLayersForBuyTrade } from "./stocksPyramidingMonitor.js";

// Base-ticker normalization: SU vs SU.TO both → SU. Used to reconcile
// broker alerts (which come in bare) with position rows (which may
// carry the exchange suffix).
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Given a leg the poller/reconciler built and an account, look for the
// account's existing position row that this leg *should* aggregate into
// (same base ticker). When found, rewrite the leg to use that row's
// exact ticker + currency + subCcy so applyLeg's strict-equality match
// merges cleanly instead of orphaning a new bare-ticker row. Also
// defensively coerces null/undefined currency to the row's ccy — a
// subject-line-only CIBC parse leaves currency=null, and the poller's
// fresh-BUY fallback picks a wrong USD default for Canadian names when
// no matching row exists in that account. Returns a NEW leg object.
function normalizeLegToPortfolioRow(positions, accountId, leg) {
  const wantBase = baseTicker(leg.ticker);
  if (!wantBase) return leg;
  const rows = (positions || []).filter(p =>
    p.acct === accountId && baseTicker(p.ticker) === wantBase && (p.qty || 0) > 0
  );
  if (rows.length === 0) return leg;
  // If multiple rows match (SU.TO CAD sub + SU USD sub in the same
  // account, edge case), prefer the row whose (subCcy || ccy) matches
  // the leg's settleCcy/currency; else fall back to the fattest lot.
  const prefer = leg.settleCcy || leg.currency;
  let chosen = rows.find(p => (p.subCcy || p.ccy) === prefer);
  if (!chosen) chosen = rows.sort((a, b) => (b.qty || 0) - (a.qty || 0))[0];
  return {
    ...leg,
    ticker: chosen.ticker,
    currency: leg.currency || chosen.ccy,
    settleCcy: leg.settleCcy || chosen.subCcy || chosen.ccy,
  };
}

// Apply a single BUY/SELL leg to the positions array (mutates). Same
// semantics as routes/stocksTrade.js:applyLeg — kept in sync manually.
// Duplicated deliberately: the route file is legacy and untangling it
// mid-flight risks the manual flow. When we come back to consolidate,
// the route should import from here, not the other way around.
function applyLeg(positions, accountId, leg) {
  const { side, ticker, shares, price, currency } = leg;
  const settleCcy = leg.settleCcy || currency;

  if (side === "BUY") {
    const idx = positions.findIndex(
      (p) => p.acct === accountId && p.ticker === ticker &&
             p.ccy === currency && (p.subCcy || p.ccy) === settleCcy
    );
    if (idx >= 0) {
      const existing = positions[idx];
      const oldQty = existing.qty || 0;
      const oldCostKey = currency === "USD" ? "costBasisUsd" : "costBasisCad";
      const newQty = oldQty + shares;
      let newCost = existing[oldCostKey];
      if (existing[oldCostKey] != null && oldQty > 0) {
        newCost = (existing[oldCostKey] * oldQty + price * shares) / newQty;
      } else if (existing[oldCostKey] == null) {
        newCost = price;
      }
      positions[idx] = {
        ...existing,
        qty: newQty,
        [oldCostKey]: newCost,
        ...(currency === "USD" ? { priceUsd: price } : { priceCad: price }),
      };
    } else {
      positions.push({
        acct: accountId, ticker, name: "",
        qty: shares, ccy: currency, subCcy: settleCcy,
        ...(currency === "USD"
          ? { priceUsd: price, priceCad: null, costBasisUsd: price, costBasisCad: null }
          : { priceCad: price, priceUsd: null, costBasisCad: price, costBasisUsd: null }),
      });
    }
    return;
  }

  // SELL
  const matchIdxs = positions
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.acct === accountId && p.ticker === ticker &&
             p.ccy === currency && (p.subCcy || p.ccy) === settleCcy)
    .map(({ i }) => i);
  if (matchIdxs.length === 0) {
    throw new Error(`Can't sell ${ticker}: no matching position in this account/currency.`);
  }
  const totalAvail = matchIdxs.reduce((s, i) => s + (positions[i].qty || 0), 0);
  if (totalAvail < shares - 1e-6) {
    throw new Error(`Can't sell ${shares} sh of ${ticker}: only ${totalAvail} on file across all lots.`);
  }
  let remaining = shares;
  for (const i of matchIdxs) {
    if (remaining <= 1e-6) break;
    const row = positions[i];
    if (row.qty <= remaining + 1e-6) {
      remaining -= row.qty;
      positions[i] = { ...row, qty: 0 };
    } else {
      positions[i] = {
        ...row, qty: row.qty - remaining,
        ...(currency === "USD" ? { priceUsd: price } : { priceCad: price }),
      };
      remaining = 0;
    }
  }
  for (let i = positions.length - 1; i >= 0; i--) {
    if ((positions[i].qty || 0) <= 1e-6) positions.splice(i, 1);
  }
}

function adjustAccountCash(account, leg, fx) {
  if (!account) return;
  const settleCcy = leg.settleCcy || leg.currency;
  const cashKey = settleCcy === "USD" ? "cashUsd" : "cashCad";
  const gross = leg.currency === settleCcy
    ? Number(leg.grossValue) || 0
    : (leg.currency === "USD" ? (Number(leg.grossValue) || 0) * fx : (Number(leg.grossValue) || 0) / fx);
  const sign = leg.side === "SELL" || leg.side === "DEPOSIT" ? 1 : -1;
  account[cashKey] = (account[cashKey] || 0) + sign * gross;
}

function netCashCadOfTrade(legs, fx) {
  let net = 0;
  for (const leg of legs) {
    const gross = Number(leg.grossValue) || 0;
    const cadValue = leg.currency === "USD" ? gross * fx : gross;
    const sign = leg.side === "SELL" || leg.side === "DEPOSIT" ? 1 : -1;
    net += sign * cadValue;
  }
  return Number.isFinite(net) ? net : 0;
}

export async function applyReconciledTrade({
  email, legs, accountId, executedAt, notes = "",
  linkedAdviceRecId = null, linkedDailyPickId = null,
  brokerReconcileKey = null, brokerReconcileSource = null,
  brokerReconcileStatus = null, brokerReconcileNotes = "",
}) {
  if (!email) throw new Error("email is required");
  if (!Array.isArray(legs) || legs.length === 0) throw new Error("legs must be non-empty");
  if (!accountId) throw new Error("accountId is required");

  const portfolio = await StocksPortfolio.findOne({ email });
  if (!portfolio) throw new Error("No portfolio found for this user");

  const acctRow = portfolio.accounts.find((a) => a.id === accountId);
  if (!acctRow) throw new Error(`Unknown account id ${accountId}`);

  const fx = portfolio.fxUsdCad || 1.37;

  // Apply legs to a copy of the positions array + adjust cash.
  const newPositions = portfolio.positions.map((p) => ({ ...(p.toObject?.() || p) }));
  // Normalize each leg so a bare "SU" merges into an existing "SU.TO"
  // row (and inherits its ccy/subCcy). Without this a poller alert for
  // "SU" with currency=null/USD would either fail SELL match or push
  // an orphan bare-ticker row — the exact silent-reconcile bug we're
  // chasing.
  const normalizedLegs = legs.map(l => normalizeLegToPortfolioRow(newPositions, accountId, l));
  for (const leg of normalizedLegs) {
    if (leg.side === "BUY" || leg.side === "SELL") {
      applyLeg(newPositions, accountId, {
        side: leg.side, ticker: leg.ticker, shares: leg.shares,
        price: leg.pricePerShare, currency: leg.currency,
        settleCcy: leg.settleCcy,
      });
    }
    adjustAccountCash(acctRow, leg, fx);
  }
  portfolio.positions = newPositions;
  // markModified is required here even though we're assigning a new
  // array to portfolio.positions. Mongoose's setter recasts the array
  // but does NOT reliably flag the path as modified when the elements
  // are plain objects produced by .toObject()/spread. Without this the
  // save() below returns clean but the positions field never hits
  // Mongo — the exact silent-no-op we saw with ROKU 29 → SELL 10
  // journaled as "positions applied" but the row still showed 29.
  portfolio.markModified("positions");
  portfolio.markModified("accounts");
  portfolio.lastSyncedAt = new Date();
  await portfolio.save();

  // Journal the trade (with dedup fields populated for poller-sourced
  // rows). positionApplied=true because we just applied above — this
  // is how backfill knows which pre-fix rows still need mutation.
  const tradeDoc = {
    email,
    executedAt: executedAt ? new Date(executedAt) : new Date(),
    account: accountId,
    accountName: acctRow.name,
    legs: normalizedLegs,
    netCashCad: netCashCadOfTrade(normalizedLegs, fx),
    fxUsdCadAtTrade: fx,
    notes: String(notes || "").slice(0, 500),
    positionApplied: true,
    ...(linkedAdviceRecId ? { linkedAdviceRecId } : {}),
    ...(linkedDailyPickId ? { linkedDailyPickId } : {}),
    ...(brokerReconcileKey ? { brokerReconcileKey } : {}),
    ...(brokerReconcileSource ? { brokerReconcileSource } : {}),
    ...(brokerReconcileStatus ? { brokerReconcileStatus } : {}),
    ...(brokerReconcileNotes ? { brokerReconcileNotes } : {}),
  };
  const trade = await StocksTradeJournal.create(tradeDoc);

  // Mark any open DailyPick on a BUY leg's ticker as ENTERED so the
  // Daily Picks UI stops treating it as a fresh idea. Matches on
  // BASE ticker (SU vs SU.TO both normalize to SU) so a US-listed
  // leg matches a TSX pick and vice versa.
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
    const openPicks = await StocksDailyPick.find({
      email, status: "open", enteredAt: null, pickDate: { $gte: cutoff },
    }).select({ _id: 1, ticker: 1 }).lean();
    for (const leg of legs) {
      if (leg.side !== "BUY" || !leg.ticker) continue;
      const legBase = baseOf(leg.ticker);
      const match = openPicks.find(p => baseOf(p.ticker) === legBase);
      if (!match) continue;
      await StocksDailyPick.updateOne(
        { _id: match._id, enteredAt: null },
        {
          $set: {
            enteredAt: trade.executedAt,
            enteredPrice: leg.pricePerShare,
            enteredShares: leg.shares,
            enteredTradeId: trade._id,
          },
        }
      );
    }
    // Add-on BUYs against an already-entered pick bump pyramid layers
    // so the pyramiding monitor doesn't re-emit the same +1R / +2R
    // trigger on tomorrow's briefing.
    await bumpPyramidLayersForBuyTrade({ email, legs, executedAt: trade.executedAt }).catch(e => console.warn("[trade-applier] pyramid bump warn:", e?.message));
  } catch (e) { console.warn("[trade-applier] daily-pick stamp warn:", e?.message); }

  // Mark the linked advice rec's exit-filled marker so the "open recs"
  // query stops returning it.
  if (linkedAdviceRecId) {
    try {
      await StocksAdviceRec.updateOne(
        { _id: linkedAdviceRecId, exitLevelsFilledBy: { $exists: false } },
        { $set: { exitLevelsFilledBy: new Date() } }
      );
    } catch { /* non-fatal */ }
  }

  return { trade, portfolio };
}

// Retroactively apply an already-journalled trade's legs to the
// portfolio (positions + account cash), then flip positionApplied on
// the trade doc so it doesn't get applied twice. Used by the
// backfill endpoint after the Phase 2B fix — pre-fix poller rows
// were journalled but never mutated the portfolio.
//
// Returns { applied: true } on success, or throws — caller decides
// how to surface failures (usually: leave positionApplied=false so
// the user can fix the account/qty manually and re-run backfill).
export async function backfillTradeToPortfolio(tradeDoc) {
  if (!tradeDoc) throw new Error("tradeDoc required");
  if (tradeDoc.positionApplied) return { applied: false, reason: "already-applied" };
  if (!tradeDoc.account) throw new Error("trade has no account — resolve manually first");
  if (!Array.isArray(tradeDoc.legs) || tradeDoc.legs.length === 0) throw new Error("trade has no legs");

  const portfolio = await StocksPortfolio.findOne({ email: tradeDoc.email });
  if (!portfolio) throw new Error("no portfolio for this trade's email");
  const acctRow = portfolio.accounts.find((a) => a.id === tradeDoc.account);
  if (!acctRow) throw new Error(`unknown account id ${tradeDoc.account}`);
  const fx = tradeDoc.fxUsdCadAtTrade || portfolio.fxUsdCad || 1.37;

  const newPositions = portfolio.positions.map((p) => ({ ...(p.toObject?.() || p) }));
  // Same suffix + currency normalization as the auto-apply path. Without
  // this, retry/backfill of a stuck bare-"SU" trade would keep failing
  // against the existing "SU.TO" row (or push a duplicate orphan).
  const normalizedLegs = tradeDoc.legs.map(l =>
    normalizeLegToPortfolioRow(newPositions, tradeDoc.account, l)
  );
  for (const leg of normalizedLegs) {
    if (leg.side === "BUY" || leg.side === "SELL") {
      applyLeg(newPositions, tradeDoc.account, {
        side: leg.side, ticker: leg.ticker, shares: leg.shares,
        price: leg.pricePerShare, currency: leg.currency, settleCcy: leg.settleCcy,
      });
    }
    adjustAccountCash(acctRow, leg, fx);
  }
  portfolio.positions = newPositions;
  // Same markModified pairing as applyReconciledTrade above — Mongoose
  // will not flag positions as dirty on plain-object assignment on its
  // own, and save() would silently persist nothing.
  portfolio.markModified("positions");
  portfolio.markModified("accounts");
  portfolio.lastSyncedAt = new Date();
  await portfolio.save();

  // Mark this trade doc so a second backfill run skips it. Also rewrite
  // the legs to the normalized form so future scorecard/fuzzy-dedup
  // lookups see the same ticker as the applied position. Then re-stamp
  // daily-pick "ENTERED" for BUY legs.
  await StocksTradeJournal.updateOne(
    { _id: tradeDoc._id },
    { $set: { positionApplied: true, legs: normalizedLegs } }
  );
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
    const openPicks = await StocksDailyPick.find({
      email: tradeDoc.email, status: "open", enteredAt: null, pickDate: { $gte: cutoff },
    }).select({ _id: 1, ticker: 1 }).lean();
    for (const leg of tradeDoc.legs) {
      if (leg.side !== "BUY" || !leg.ticker) continue;
      const legBase = baseOf(leg.ticker);
      const match = openPicks.find(p => baseOf(p.ticker) === legBase);
      if (!match) continue;
      await StocksDailyPick.updateOne(
        { _id: match._id, enteredAt: null },
        { $set: {
            enteredAt: tradeDoc.executedAt,
            enteredPrice: leg.pricePerShare,
            enteredShares: leg.shares,
            enteredTradeId: tradeDoc._id,
          } }
      );
    }
    await bumpPyramidLayersForBuyTrade({ email: tradeDoc.email, legs: tradeDoc.legs, executedAt: tradeDoc.executedAt }).catch(e => console.warn("[trade-applier/backfill] pyramid bump warn:", e?.message));
  } catch (e) { console.warn("[trade-applier/backfill] daily-pick stamp warn:", e?.message); }

  return { applied: true };
}
