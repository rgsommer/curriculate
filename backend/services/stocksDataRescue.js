// backend/services/stocksDataRescue.js
//
// P3.6 (2026-09-10) — data-quality rescue pipeline.
//
// Reads canonical Mongo data + the P3 ledger and produces:
//   • unattributableReasonBreakdown  — reason codes per UNATTRIBUTABLE row
//   • openingBalanceLots             — reconstructed OPENING_BALANCE lots
//                                       from the current portfolio's cost
//                                       basis when the journal lacks a BUY
//   • recLinkReconciliation          — additional trade↔rec links proposed
//                                       by deterministic ticker+time+account
//                                       matching (never overwrites EXPLICIT)
//   • transferCandidates             — same-ticker same-shares different-
//                                       account within a short window;
//                                       marked POSSIBLE_TRANSFER, never
//                                       promoted to realized P&L
//
// Nothing here writes to production collections other than an explicit
// audit collection (StocksDataRescueAudit) for reproducibility. The
// engine reads this at attribution time to know what data is real.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";

// ─── Reason codes for UNATTRIBUTABLE ledger rows ───────────────────
export const UNATTRIB_REASONS = {
  MISSING_BUY_LEG: "SELL with no matching BUY in the trade journal",
  PRE_JOURNAL_OPENING_POSITION: "Position pre-dates the trade journal history",
  MISSING_ENTRY_DATE: "Entry date could not be established",
  MISSING_ENTRY_PRICE: "Entry price could not be established",
  MISSING_QUANTITY: "Share quantity could not be established",
  MISSING_ACCOUNT: "Account attribution could not be established",
  MISSING_FX: "USD row lacks FX at entry and/or exit",
  POSSIBLE_TRANSFER: "Looks like an account transfer, not a real economic sell",
  AMBIGUOUS_HISTORY: "Multiple plausible histories; refuse to guess",
  OTHER: "Uncategorized reconstruction gap",
};

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }
function baseTicker(t) { return String(t || "").toUpperCase().replace(/\..*$/, ""); }

// PUBLIC — classify why each ledger row was marked UNATTRIBUTABLE.
export function classifyUnattributableRows({ ledgerRows, trades }) {
  const journalStart = trades.length > 0 ? new Date(trades[0].executedAt) : null;
  const byReason = {};
  const byTicker = {};
  const perRow = [];
  for (const r of ledgerRows || []) {
    if (r.dataQuality !== "UNATTRIBUTABLE") continue;
    let reason = "OTHER";
    const missing = new Set(r.missingFields || []);
    if (missing.has("entryDate") && !missing.has("entryPrice") && !missing.has("entryShares")) {
      reason = "PRE_JOURNAL_OPENING_POSITION";
    } else if (missing.has("entryDate") && missing.has("entryPrice") && missing.has("entryShares")) {
      // A SELL with no prior BUY — very often the position pre-dates the
      // journal. Distinguish only when we have positive evidence.
      const exitInWindow = r.exitDate && journalStart && new Date(r.exitDate) < new Date(journalStart.getTime() + 7 * 86400_000);
      reason = exitInWindow ? "PRE_JOURNAL_OPENING_POSITION" : "MISSING_BUY_LEG";
    } else if (missing.has("entryPrice")) reason = "MISSING_ENTRY_PRICE";
    else if (missing.has("entryShares")) reason = "MISSING_QUANTITY";
    else if (missing.has("entryDate")) reason = "MISSING_ENTRY_DATE";
    else if (!r.account) reason = "MISSING_ACCOUNT";
    if (missing.has("entryFx") || missing.has("exitFx")) reason = "MISSING_FX";
    byReason[reason] = (byReason[reason] || 0) + 1;
    byTicker[r.ticker] = (byTicker[r.ticker] || 0) + 1;
    perRow.push({
      ticker: r.ticker, account: r.account, exitDate: r.exitDate,
      exitShares: r.exitShares, exitPrice: r.exitPrice,
      reason, reasonHuman: UNATTRIB_REASONS[reason],
    });
  }
  return { byReason, byTicker, perRow, total: perRow.length };
}

// PUBLIC — build OPENING_BALANCE lots from the current portfolio when a
// held ticker has no matching BUY in the journal. Provenance:
//   OPENING_POSITION_COST_BASIS — MEDIUM confidence (real avgCost + shares)
//   POSITION_HISTORY            — MEDIUM
//   UNKNOWN                     — LOW (skip if no cost basis)
//
// These lots support realized/unrealized P&L in CAD but MUST be flagged
// as ineligible for matched-benchmark selection alpha (no true entry date).
export async function buildOpeningBalanceLots({ email, trades }) {
  const portfolio = await StocksPortfolio.findOne({ email: String(email).toLowerCase() }).lean().catch(() => null);
  if (!portfolio) return { lots: [], note: "no-portfolio-doc" };

  // For each held position, sum BUY minus SELL from the journal for the
  // same (ticker, account). If shares are outstanding after that netting,
  // the excess must have come from a pre-journal open.
  const journalNet = new Map(); // key = ticker::account, val = shares
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      if (!(leg.shares > 0) || !leg.ticker) continue;
      const key = `${baseTicker(leg.ticker)}::${t.account || ""}`;
      const sign = leg.side === "BUY" ? 1 : -1;
      journalNet.set(key, (journalNet.get(key) || 0) + sign * leg.shares);
    }
  }

  const lots = [];
  for (const p of portfolio.positions || []) {
    if (!p.ticker || !(p.qty > 0)) continue;
    const key = `${baseTicker(p.ticker)}::${p.account || ""}`;
    const netFromJournal = journalNet.get(key) || 0;
    const preJournalShares = p.qty - netFromJournal;
    if (preJournalShares <= 1e-6) continue; // journal fully explains it
    const avgCost = Number(p.avgCost) || null;
    const provenance = avgCost > 0 ? "OPENING_POSITION_COST_BASIS" : "UNKNOWN";
    const confidence = avgCost > 0 ? "MEDIUM" : "LOW";
    lots.push({
      email: String(email).toLowerCase(),
      ticker: p.ticker, account: p.account || null,
      shares: preJournalShares,
      entryDate: null,
      entryPrice: avgCost,
      entryCurrency: p.ccy || "USD",
      sleeve: p.sleeve || null,
      entryProvenance: provenance,
      confidence,
      eligibleForMatchedAlpha: false,
      eligibleForCadPnL: avgCost > 0,
      note: avgCost > 0
        ? "OPENING_BALANCE — supports P&L, NOT matched-alpha (no true entry date)"
        : "OPENING_BALANCE — cost basis unknown; excluded from P&L",
    });
  }
  return { lots, note: null };
}

// PUBLIC — attempt to reconcile trade↔recommendation links for trades
// that lack linkedAdviceRecId. Never overwrites EXPLICIT.
//   Priority:
//     1. explicit existing link             → EXPLICIT / HIGH
//     2. exact mandate/redeploy match       → RECONCILED_MANDATE / HIGH
//        (rec.sourceLabel + generatedAt within ±60min of executedAt)
//     3. ticker + direction + account + close time (≤3 trading days)
//        AND unique candidate rec           → RECONCILED_TIME / MEDIUM
//     4. otherwise                          → NONE / LOW
export async function reconcileRecLinks({ email, trades }) {
  const em = String(email).toLowerCase();
  const recs = await StocksAdviceRec.find({ email: em }).lean().catch(() => []);
  const byTicker = new Map();
  for (const r of recs) {
    const key = String(r.ticker || "").toUpperCase();
    if (!byTicker.has(key)) byTicker.set(key, []);
    byTicker.get(key).push(r);
  }

  const before = { explicit: 0, none: 0 };
  const after = { explicit: 0, reconciledMandate: 0, reconciledTime: 0, none: 0, ambiguousRejected: 0 };
  const proposed = []; // trades that would gain a link (not persisted here)
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      if (t.linkedAdviceRecId) { before.explicit++; after.explicit++; continue; }
      before.none++;

      const tk = String(leg.ticker || "").toUpperCase();
      const candidates = (byTicker.get(tk) || []).filter(r => {
        if (r.action && String(r.action).toUpperCase() !== leg.side) return false;
        if (r.account && t.account && r.account !== t.account) return false;
        return true;
      });

      // Step 2 — mandate/redeploy label match, tight time window.
      const mandateMatch = candidates.find(r => {
        const label = String(r.sourceLabel || "").toLowerCase();
        if (!label.startsWith("mandate:")) return false;
        const dt = Math.abs(new Date(t.executedAt) - new Date(r.generatedAt || 0));
        return dt <= 60 * 60_000; // ±60 minutes
      });
      if (mandateMatch) {
        after.reconciledMandate++;
        proposed.push({
          tradeId: String(t._id), leg: leg.side, ticker: tk,
          recId: String(mandateMatch._id), linkMethod: "RECONCILED_MANDATE", linkConfidence: "HIGH",
          basis: `mandate label ${mandateMatch.sourceLabel} at ${ymd(mandateMatch.generatedAt)}`,
        });
        continue;
      }

      // Step 3 — ticker + direction + account + close time (≤3 trading days).
      const timeWindow = 3 * 86400_000;
      const nearby = candidates.filter(r => {
        const dt = Math.abs(new Date(t.executedAt) - new Date(r.generatedAt || 0));
        return dt <= timeWindow;
      });
      if (nearby.length === 1) {
        after.reconciledTime++;
        proposed.push({
          tradeId: String(t._id), leg: leg.side, ticker: tk,
          recId: String(nearby[0]._id), linkMethod: "RECONCILED_TIME", linkConfidence: "MEDIUM",
          basis: `single rec within ±3d for ${tk}/${leg.side}`,
        });
        continue;
      }
      if (nearby.length > 1) {
        after.ambiguousRejected++;
        after.none++;
        continue;
      }
      after.none++;
    }
  }
  return { before, after, proposed };
}

// PUBLIC — detect possible account transfers rather than real sells.
// A transfer looks like: same ticker, approximately same shares, in
// different accounts, within a short window, no clear economic evidence
// (both legs in the same day / consecutive days, no matching rec).
export function detectAccountTransfers({ trades }) {
  const events = [];
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      if (!leg.ticker || !(leg.shares > 0)) continue;
      events.push({
        tradeId: String(t._id), executedAt: t.executedAt,
        side: leg.side, ticker: baseTicker(leg.ticker),
        rawTicker: leg.ticker,
        shares: leg.shares, price: leg.pricePerShare,
        account: t.account || null,
      });
    }
  }
  events.sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));
  const candidates = [];
  const usedIds = new Set();
  for (let i = 0; i < events.length; i++) {
    if (usedIds.has(i)) continue;
    const a = events[i];
    if (a.side !== "SELL") continue;
    for (let j = i + 1; j < events.length; j++) {
      if (usedIds.has(j)) continue;
      const b = events[j];
      if (b.side !== "BUY") continue;
      if (a.ticker !== b.ticker) continue;
      if (a.account === b.account) continue;
      const dt = Math.abs(new Date(b.executedAt) - new Date(a.executedAt));
      if (dt > 3 * 86400_000) continue;
      const sharesRatio = a.shares / b.shares;
      if (sharesRatio < 0.98 || sharesRatio > 1.02) continue;
      candidates.push({
        soldTradeId: a.tradeId, soldAccount: a.account,
        boughtTradeId: b.tradeId, boughtAccount: b.account,
        ticker: a.rawTicker, shares: a.shares,
        soldPrice: a.price, boughtPrice: b.price,
        soldOn: ymd(a.executedAt), boughtOn: ymd(b.executedAt),
        classification: "POSSIBLE_TRANSFER",
        note: "Same ticker, ≈same shares, different accounts, within 3d. Excluded from realized-P&L and churn until confirmed as economic sell/buy.",
      });
      usedIds.add(i); usedIds.add(j);
      break;
    }
  }
  return { candidates, count: candidates.length };
}

// PUBLIC — run all four rescue passes at once.
export async function runDataRescue({ email }) {
  const em = String(email).toLowerCase();
  const trades = await StocksTradeJournal.find({ email: em }).sort({ executedAt: 1 }).lean();
  const [openingResult, linkResult, transferResult] = await Promise.all([
    buildOpeningBalanceLots({ email: em, trades }),
    reconcileRecLinks({ email: em, trades }),
    Promise.resolve(detectAccountTransfers({ trades })),
  ]);
  return {
    email: em,
    generatedAt: new Date().toISOString(),
    openingBalanceLots: openingResult.lots,
    openingBalanceNote: openingResult.note,
    recLinkReconciliation: linkResult,
    transferCandidates: transferResult.candidates,
    // classifyUnattributableRows needs the ledger — caller pipes it in.
  };
}
