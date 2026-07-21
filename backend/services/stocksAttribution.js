// backend/services/stocksAttribution.js
//
// Return attribution: where did closed-trade $ P&L actually come from?
// Calibration answers "which combinations HAVE a good win rate?"; this
// service answers "which combinations HAVE actually printed money?"
// The two look similar but tell different stories — a 90% win rate
// with $50 per win vs a 50% win rate with $2000 per win is the
// difference between "cute" and "load-bearing."
//
// Method:
//   1. Walk the trade journal in date order, maintaining a FIFO lot
//      queue per ticker.
//   2. Every SELL leg closes lots FIFO; realized P&L per SELL is
//      Σ (sellPrice - buyPrice) × sharesFromLot, minus commissions.
//   3. Attribute each closed round-trip to:
//        • sleeve       (via classifyPosition on the ticker)
//        • setup        (via linkedAdviceRecId → StocksAdviceRec.setupName,
//                        or via linkedDailyPickId → StocksDailyPick.setupName,
//                        or "unclassified")
//        • scoreBand    (via linkedDailyPickId → deterministicScore)
//        • aiSourced    (true if either linked-id exists)
//   4. Sum $ CAD (using fxUsdCadAtTrade) into bucket totals.
//
// The FX conversion is per-leg at trade time — matches the trader's
// actual experience since they didn't retroactively re-fx historical
// realized gains.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";

const LOOKBACK_DAYS = 365;

function normalizeSetup(name) {
  if (!name) return "unclassified";
  const s = String(name).toLowerCase();
  if (s.includes("vcp") || s.includes("volatility contraction")) return "vcp";
  if (s.includes("bull flag") || s.includes("flag")) return "bull-flag";
  if (s.includes("pocket pivot")) return "pocket-pivot";
  if (s.includes("coiled") || s.includes("spring")) return "coiled-spring";
  if (s.includes("inside day") || s.includes("inside bar")) return "inside-day";
  if (s.includes("cup") && s.includes("handle")) return "cup-and-handle";
  if (s.includes("breakout")) return "breakout";
  if (s.includes("pullback")) return "pullback";
  return "other";
}

function scoreBand(score) {
  const s = Number(score);
  if (!Number.isFinite(s) || s <= 0) return "unscored";
  if (s >= 80) return "80+";
  if (s >= 70) return "70-79";
  if (s >= 60) return "60-69";
  if (s >= 50) return "50-59";
  return "0-49";
}

export async function computeAttribution(email) {
  if (!email) return null;
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  // Pull ALL trades in the lookback so we see opening + closing legs
  // even when the SELL is inside the window and the BUY predates it.
  const trades = await StocksTradeJournal.find({
    email,
    executedAt: { $gte: new Date(since.getTime() - 365 * 86400000) },
  })
    .populate("linkedAdviceRecId", "setupName")
    .populate("linkedDailyPickId", "setupName deterministicScore")
    .sort({ executedAt: 1 })
    .lean();

  if (trades.length === 0) return { totalRealizedCad: 0, closedTrades: 0, bySleeve: [], bySetup: [], byScoreBand: [], byAiSource: [] };

  // FIFO lots per ticker: { qty, costCad, ccy, buyDate, linkage }.
  const lots = new Map();

  const closes = []; // one row per matched round-trip chunk

  for (const t of trades) {
    const fx = t.fxUsdCadAtTrade || 1.37;
    for (const leg of t.legs || []) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      const ticker = String(leg.ticker || "").toUpperCase();
      if (!ticker) continue;
      const shares = leg.shares || 0;
      const px = leg.pricePerShare || 0;
      const gross = (leg.grossValue != null ? leg.grossValue : shares * px);
      const perShareCad = leg.currency === "USD" ? px * fx : px;

      if (leg.side === "BUY") {
        if (!lots.has(ticker)) lots.set(ticker, []);
        lots.get(ticker).push({
          qty: shares,
          costPerShareCad: perShareCad,
          buyDate: t.executedAt,
          setup: normalizeSetup(t.linkedAdviceRecId?.setupName || t.linkedDailyPickId?.setupName),
          scoreBand: scoreBand(t.linkedDailyPickId?.deterministicScore),
          aiSourced: !!(t.linkedAdviceRecId || t.linkedDailyPickId),
        });
      } else {
        // SELL: pop FIFO lots until we've covered `shares`.
        const queue = lots.get(ticker) || [];
        let toClose = shares;
        while (toClose > 0 && queue.length > 0) {
          const lot = queue[0];
          const take = Math.min(lot.qty, toClose);
          const proceedsCad = take * perShareCad;
          const costCad = take * lot.costPerShareCad;
          const pnlCad = proceedsCad - costCad;
          const holdDays = Math.max(0, Math.round((new Date(t.executedAt) - new Date(lot.buyDate)) / 86400000));
          closes.push({
            ticker,
            closedAt: t.executedAt,
            shares: take,
            proceedsCad,
            costCad,
            pnlCad,
            holdDays,
            setup: lot.setup,
            scoreBand: lot.scoreBand,
            aiSourced: lot.aiSourced,
          });
          lot.qty -= take;
          toClose -= take;
          if (lot.qty <= 0) queue.shift();
        }
        // Any leftover shares are a shorting trade or a data glitch — ignore.
      }
    }
  }

  // Filter closes to the reporting window (closedAt within LOOKBACK_DAYS).
  const inWindow = closes.filter((c) => new Date(c.closedAt) >= since);

  const bucketize = (rows, keyFn) => {
    const groups = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!groups.has(k)) groups.set(k, { key: k, count: 0, wins: 0, totalPnlCad: 0, avgHoldDays: 0 });
      const g = groups.get(k);
      g.count++;
      if (r.pnlCad > 0) g.wins++;
      g.totalPnlCad += r.pnlCad;
      g.avgHoldDays += r.holdDays;
    }
    const out = [];
    for (const g of groups.values()) {
      g.avgHoldDays = g.count > 0 ? g.avgHoldDays / g.count : 0;
      g.winRatePct = g.count > 0 ? (g.wins / g.count) * 100 : 0;
      out.push(g);
    }
    out.sort((a, b) => b.totalPnlCad - a.totalPnlCad);
    return out;
  };

  const totalRealizedCad = inWindow.reduce((s, r) => s + r.pnlCad, 0);

  return {
    lookbackDays: LOOKBACK_DAYS,
    closedTrades: inWindow.length,
    totalRealizedCad,
    bySleeve: bucketize(inWindow, (r) => classifyPosition({ ticker: r.ticker }) || "spec"),
    bySetup: bucketize(inWindow, (r) => r.setup),
    byScoreBand: bucketize(inWindow, (r) => r.scoreBand),
    byAiSource: bucketize(inWindow, (r) => r.aiSourced ? "ai-sourced" : "manual"),
  };
}

export function formatAttributionBlock(att) {
  if (!att || !att.closedTrades) return "";
  const $ = (v) => `${v >= 0 ? "+" : ""}$${Math.round(v).toLocaleString()} CAD`;
  const pct = (v) => `${v.toFixed(0)}%`;
  const rowLine = (r) => `    ${r.key}: n=${r.count} · ${$(r.totalPnlCad)} · win rate ${pct(r.winRatePct)} · avg hold ${Math.round(r.avgHoldDays)}d`;

  const lines = [
    `\nRETURN ATTRIBUTION (closed round-trips, last ${att.lookbackDays} days):`,
    `  Realized: ${$(att.totalRealizedCad)} across ${att.closedTrades} round-trips`,
  ];
  if (att.bySleeve.length) {
    lines.push(`  By sleeve:`);
    for (const r of att.bySleeve) lines.push(rowLine(r));
  }
  if (att.byAiSource.length) {
    lines.push(`  AI-sourced vs manual:`);
    for (const r of att.byAiSource) lines.push(rowLine(r));
  }
  if (att.bySetup.length) {
    lines.push(`  By setup (top 5 by $ P&L):`);
    for (const r of att.bySetup.slice(0, 5)) lines.push(rowLine(r));
  }
  if (att.byScoreBand.length) {
    lines.push(`  By score band:`);
    for (const r of att.byScoreBand) lines.push(rowLine(r));
  }
  lines.push(`\nHow to use:`);
  lines.push(`  - Cite these on Mondays or when a debated rec sits in a bucket that has printed real money (or bled real money). "Bull-flag setups have printed +$3,400 CAD YTD; this one fits that bucket, full size."`);
  lines.push(`  - If AI-sourced $ P&L is <10% of manual $ P&L across the window, note it: the operator is (rightfully) the source of the edge; AI is a check. If AI-sourced dominates, the AI is earning its keep.`);
  lines.push(`  - Negative buckets are honest: a setup type that's cost real money isn't just under-tested, it's actively losing. Downgrade or skip.`);
  return lines.join("\n");
}
