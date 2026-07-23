// backend/services/stocksJournalAudit.js
//
// Duplicate-journal audit + delete-with-reversal. Clusters recorded
// trades by a compact fingerprint (email + ticker + account + side +
// shares within a 3-day window) so duplicates surface as groups the
// trader can prune in bulk. Each deletion REVERSES the trade's leg
// mutations on positions + cash before removing the journal doc, so
// the position rows heal as duplicates are pruned.
//
// The reversal reuses the applyLeg semantics from the trade applier —
// a BUY reversal is a SELL of the same shares at the same price; a
// SELL reversal is a BUY. Cash flips sign symmetrically. If a
// reversal would leave a position negative (an audit deleting a BUY
// after subsequent SELLs already ran) the reversal fails and the
// trade is left alone with an error in the response.

import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";

const DUP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Base-ticker normalization so SU / SU.TO count as the same for
// clustering.
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

function legFingerprint(t) {
  const leg = (t.legs || [])[0];
  if (!leg) return null;
  return {
    ticker: baseTicker(leg.ticker),
    side: leg.side,
    shares: leg.shares,
    account: t.account || "",
    pricePerShare: Number.isFinite(leg.pricePerShare) ? Math.round(leg.pricePerShare * 100) / 100 : null,
  };
}

// Group trades by fingerprint within a 3-day sliding window. Returns
// groups with >= 2 trades — those are the actionable duplicates. Also
// annotates each row with tradeId + timestamp + linked-rec presence
// so the UI can help the user pick which to keep (usually the one
// with a linked rec).
export async function findDuplicateJournalGroups(email, { days = 90 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const trades = await StocksTradeJournal.find({
    email, executedAt: { $gte: since },
  }).sort({ executedAt: 1 }).lean();

  // Bucket by fingerprint. Then within each bucket, subgroup by time
  // proximity (< DUP_WINDOW_MS between consecutive trades).
  const byFp = new Map();
  for (const t of trades) {
    const fp = legFingerprint(t);
    if (!fp) continue;
    const key = `${fp.ticker}|${fp.account}|${fp.side}|${fp.shares}`;
    if (!byFp.has(key)) byFp.set(key, []);
    byFp.get(key).push({ ...t, _fp: fp });
  }

  const groups = [];
  for (const [key, rows] of byFp.entries()) {
    // Sort by time and split into 3-day windows
    rows.sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));
    let cluster = [rows[0]];
    for (let i = 1; i < rows.length; i++) {
      const prev = cluster[cluster.length - 1];
      const gap = new Date(rows[i].executedAt) - new Date(prev.executedAt);
      if (gap <= DUP_WINDOW_MS) {
        cluster.push(rows[i]);
      } else {
        if (cluster.length >= 2) groups.push(makeGroup(key, cluster));
        cluster = [rows[i]];
      }
    }
    if (cluster.length >= 2) groups.push(makeGroup(key, cluster));
  }

  // Rank: biggest clusters first (they cost the trader the most to
  // reconcile manually), then most recent so the user sees today's
  // problems above last month's.
  groups.sort((a, b) => (b.trades.length - a.trades.length) || (new Date(b.mostRecent) - new Date(a.mostRecent)));
  return groups;
}

function makeGroup(key, cluster) {
  const [tickerBase, account, side, sharesStr] = key.split("|");
  const dates = cluster.map(t => new Date(t.executedAt));
  return {
    fingerprint: { tickerBase, account, side, shares: parseFloat(sharesStr) },
    accountName: cluster[0].accountName || cluster[0].account || "—",
    spanHours: Math.round((Math.max(...dates) - Math.min(...dates)) / 3600000),
    firstAt: cluster[0].executedAt,
    mostRecent: cluster[cluster.length - 1].executedAt,
    trades: cluster.map(t => ({
      _id: String(t._id),
      executedAt: t.executedAt,
      leg: t.legs?.[0] ? `${t.legs[0].side} ${t.legs[0].shares} ${t.legs[0].ticker} @ $${t.legs[0].pricePerShare} ${t.legs[0].currency}` : null,
      account: t.accountName || t.account || "—",
      status: t.brokerReconcileStatus || null,
      source: t.brokerReconcileSource || null,
      positionApplied: !!t.positionApplied,
      linkedAdviceRecId: t.linkedAdviceRecId ? String(t.linkedAdviceRecId) : null,
      linkedDailyPickId: t.linkedDailyPickId ? String(t.linkedDailyPickId) : null,
      notes: (t.notes || "").slice(0, 140),
    })),
  };
}

// Reverse a single applied leg on the positions array. Mutates in
// place. Throws on impossible reversal (SELL reversal would make a
// negative position, etc). Returns the leg for logging.
function reverseLegOnPositions(positions, accountId, leg) {
  const ticker = String(leg.ticker || "").toUpperCase();
  const currency = leg.currency;
  const settleCcy = leg.settleCcy || currency;
  const shares = leg.shares || 0;
  const price = leg.pricePerShare || 0;

  // Reversing a BUY = subtract shares from the matching position row.
  // Reversing a SELL = add shares back (create row if missing).
  if (leg.side === "BUY") {
    const idxs = positions
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.acct === accountId && p.ticker === ticker &&
                         p.ccy === currency && (p.subCcy || p.ccy) === settleCcy)
      .map(({ i }) => i);
    // Try base-ticker fallback if no exact match (fixes rescue rows
    // that landed as "SU" bare while the position stored "SU.TO").
    const baseFallback = idxs.length === 0
      ? positions
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.acct === accountId
                             && String(p.ticker || "").toUpperCase().replace(/\..*$/, "") === ticker.replace(/\..*$/, ""))
          .map(({ i }) => i)
      : idxs;
    const totalAvail = baseFallback.reduce((s, i) => s + (positions[i].qty || 0), 0);
    if (totalAvail < shares - 1e-6) {
      throw new Error(`Can't reverse BUY ${shares} sh ${ticker} in account: only ${totalAvail} sh on file across matching lots.`);
    }
    let remaining = shares;
    for (const i of baseFallback) {
      if (remaining <= 1e-6) break;
      const row = positions[i];
      if (row.qty <= remaining + 1e-6) {
        remaining -= row.qty;
        positions[i] = { ...row, qty: 0 };
      } else {
        positions[i] = { ...row, qty: row.qty - remaining };
        remaining = 0;
      }
    }
    for (let i = positions.length - 1; i >= 0; i--) {
      if ((positions[i].qty || 0) <= 1e-6) positions.splice(i, 1);
    }
    return;
  }

  // Reverse SELL = add shares back into the matching row (or create).
  if (leg.side === "SELL") {
    const idx = positions.findIndex(
      p => p.acct === accountId && p.ticker === ticker &&
           p.ccy === currency && (p.subCcy || p.ccy) === settleCcy
    );
    if (idx >= 0) {
      const existing = positions[idx];
      positions[idx] = { ...existing, qty: (existing.qty || 0) + shares };
    } else {
      positions.push({
        acct: accountId, ticker, name: "",
        qty: shares, ccy: currency, subCcy: settleCcy,
        priceUsd: currency === "USD" ? price : null,
        priceCad: currency === "CAD" ? price : null,
        costBasisUsd: currency === "USD" ? price : null,
        costBasisCad: currency === "CAD" ? price : null,
      });
    }
    return;
  }
  // BUY/SELL only for reversal. Everything else (DEPOSIT etc.) skipped.
}

function reverseCashOnAccount(account, leg, fx) {
  if (!account) return;
  const settleCcy = leg.settleCcy || leg.currency;
  const cashKey = settleCcy === "USD" ? "cashUsd" : "cashCad";
  const gross = leg.currency === settleCcy
    ? Number(leg.grossValue) || (leg.pricePerShare * leg.shares) || 0
    : (leg.currency === "USD" ? (Number(leg.grossValue) || (leg.pricePerShare * leg.shares) || 0) * fx
                              : (Number(leg.grossValue) || (leg.pricePerShare * leg.shares) || 0) / fx);
  // BUY was DEBIT → reversal is CREDIT. SELL was CREDIT → reversal is DEBIT.
  const sign = leg.side === "BUY" ? 1 : -1;
  account[cashKey] = (account[cashKey] || 0) + sign * gross;
}

// Delete a trade and reverse its position/cash mutation. Returns
// { deleted, reversedLegs } or throws on impossible reversal.
export async function deleteTradeWithReversal(email, tradeId) {
  const doc = await StocksTradeJournal.findOne({ _id: tradeId, email });
  if (!doc) throw new Error(`Trade not found: ${tradeId}`);
  const portfolio = await StocksPortfolio.findOne({ email });
  if (!portfolio) throw new Error("No portfolio for this user");
  const fx = portfolio.fxUsdCad || 1.37;

  const applied = !!doc.positionApplied;
  if (applied) {
    const acctRow = (portfolio.accounts || []).find(a => a.id === doc.account);
    const newPositions = portfolio.positions.map(p => ({ ...(p.toObject?.() || p) }));
    for (const leg of doc.legs || []) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      reverseLegOnPositions(newPositions, doc.account, leg);
      reverseCashOnAccount(acctRow, leg, fx);
    }
    portfolio.positions = newPositions;
    portfolio.markModified("positions");
    portfolio.markModified("accounts");
    portfolio.lastSyncedAt = new Date();
    await portfolio.save();
  }
  await StocksTradeJournal.deleteOne({ _id: doc._id });
  return { deleted: true, reversedLegs: doc.legs || [], wasApplied: applied };
}
