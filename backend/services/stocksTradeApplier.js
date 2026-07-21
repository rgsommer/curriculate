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
  for (const leg of legs) {
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
    legs,
    netCashCad: netCashCadOfTrade(legs, fx),
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
  // Daily Picks UI stops treating it as a fresh idea (mirrors the
  // manual flow's behavior).
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    for (const leg of legs) {
      if (leg.side !== "BUY" || !leg.ticker) continue;
      await StocksDailyPick.updateOne(
        {
          email, ticker: leg.ticker, status: "open",
          enteredAt: null, pickDate: { $gte: cutoff },
        },
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
  for (const leg of tradeDoc.legs) {
    if (leg.side === "BUY" || leg.side === "SELL") {
      applyLeg(newPositions, tradeDoc.account, {
        side: leg.side, ticker: leg.ticker, shares: leg.shares,
        price: leg.pricePerShare, currency: leg.currency, settleCcy: leg.settleCcy,
      });
    }
    adjustAccountCash(acctRow, leg, fx);
  }
  portfolio.positions = newPositions;
  portfolio.markModified("accounts");
  portfolio.lastSyncedAt = new Date();
  await portfolio.save();

  // Mark this trade doc so a second backfill run skips it. Also
  // re-stamp daily-pick "ENTERED" for BUY legs — matches the
  // apply-through-manual-flow behavior.
  await StocksTradeJournal.updateOne(
    { _id: tradeDoc._id },
    { $set: { positionApplied: true } }
  );
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    for (const leg of tradeDoc.legs) {
      if (leg.side !== "BUY" || !leg.ticker) continue;
      await StocksDailyPick.updateOne(
        { email: tradeDoc.email, ticker: leg.ticker, status: "open",
          enteredAt: null, pickDate: { $gte: cutoff } },
        { $set: {
            enteredAt: tradeDoc.executedAt,
            enteredPrice: leg.pricePerShare,
            enteredShares: leg.shares,
            enteredTradeId: tradeDoc._id,
          } }
      );
    }
  } catch (e) { console.warn("[trade-applier/backfill] daily-pick stamp warn:", e?.message); }

  return { applied: true };
}
