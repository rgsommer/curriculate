// backend/services/stocksBacktest.js
//
// Paper-trade backtest of the AI's recorded BUY recommendations against
// a hypothetical starting capital over a lookback window. Answers
// "what if I had followed every 'buy' rec for the last 30 days with $50k?"
//
// Sizing model: equal-weight allocation across up to `maxConcurrent`
// open positions ($capital / maxConcurrent per trade). BUY recs that
// arrive while all slots are open are logged as "missed" — realistic
// (you can't take unlimited trades on a fixed budget).
//
// Exit rule per position, in order of precedence:
//   1. If StocksAdviceRec.status = "target-hit" → exit at hitPrice on hitAt
//   2. If StocksAdviceRec.status = "stop-hit"   → exit at hitPrice on hitAt
//   3. If a SELL/TRIM rec for the same ticker landed later → exit at that rec's entryPrice on its generatedAt
//   4. Otherwise → mark to market at TODAY's price from Yahoo
//
// Currency: reported entirely in the trade's entryCurrency. Mixed USD/
// CAD trades are aggregated in each currency separately for honesty.

import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { getTechnicals } from "./stocksTechnicals.js";

async function currentPrice(ticker, currency) {
  const t = await getTechnicals(ticker, currency).catch(() => null);
  if (!t?.ok || !Number.isFinite(t.last)) return null;
  return t.last;
}

// Fetch daily closes for SPY over the window from Yahoo — the benchmark.
// Simple call so we don't drag in the full technicals pipeline.
async function spyReturnPct(days) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=3mo&interval=1d`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate Backtest)" } });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const timestamps = j?.chart?.result?.[0]?.timestamp || [];
    const clean = [];
    for (let i = 0; i < closes.length; i++) {
      if (Number.isFinite(closes[i])) clean.push({ t: timestamps[i] * 1000, c: closes[i] });
    }
    if (clean.length < 2) return null;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const startBar = clean.find((b) => b.t >= cutoff) || clean[0];
    const endBar = clean[clean.length - 1];
    return ((endBar.c - startBar.c) / startBar.c) * 100;
  } catch { return null; }
}

export async function runBacktest({ email, capital = 50000, days = 30, maxConcurrent = 10 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // All recs for this user in window, oldest-first (we walk chronologically).
  const recs = await StocksAdviceRec.find({ email, generatedAt: { $gte: since } })
    .sort({ generatedAt: 1 })
    .lean();

  if (recs.length === 0) {
    return {
      ok: false,
      reason: `No AI recommendations recorded in the last ${days} days. Enable daily briefings or run /advice to seed the log.`,
    };
  }

  const buys = recs.filter((r) => r.action === "BUY" && Number.isFinite(r.entryPrice) && r.entryPrice > 0);
  const perTradeCapital = capital / maxConcurrent;

  // Group non-BUY (SELL/TRIM/HOLD) recs by ticker so we can look up matching
  // exits deterministically without re-scanning.
  const nonBuysByTicker = {};
  for (const r of recs.filter((r) => r.action === "SELL" || r.action === "TRIM")) {
    const t = r.ticker.toUpperCase();
    if (!nonBuysByTicker[t]) nonBuysByTicker[t] = [];
    nonBuysByTicker[t].push(r);
  }

  const openPositions = new Set(); // ticker (unique holds — one position per ticker at a time)
  const closed = [];               // final trade log
  const skipped = [];              // BUY recs missed because slots full or ticker already open

  for (const buy of buys) {
    const ticker = buy.ticker.toUpperCase();
    if (openPositions.has(ticker)) {
      skipped.push({ ticker, reason: "already open (avoid stacking)", generatedAt: buy.generatedAt });
      continue;
    }
    if (openPositions.size >= maxConcurrent) {
      skipped.push({ ticker, reason: `all ${maxConcurrent} slots full`, generatedAt: buy.generatedAt });
      continue;
    }
    openPositions.add(ticker);

    // Determine exit:
    let exitDate = null;
    let exitPrice = null;
    let exitReason = null;

    if (buy.status === "target-hit" && Number.isFinite(buy.hitPrice)) {
      exitDate = buy.hitAt || new Date();
      exitPrice = buy.hitPrice;
      exitReason = "target-hit";
    } else if (buy.status === "stop-hit" && Number.isFinite(buy.hitPrice)) {
      exitDate = buy.hitAt || new Date();
      exitPrice = buy.hitPrice;
      exitReason = "stop-hit";
    } else {
      // Look for a later SELL/TRIM rec on same ticker
      const later = (nonBuysByTicker[ticker] || []).find((r) => new Date(r.generatedAt) > new Date(buy.generatedAt));
      if (later && Number.isFinite(later.entryPrice) && later.entryPrice > 0) {
        exitDate = later.generatedAt;
        exitPrice = later.entryPrice;
        exitReason = `${later.action.toLowerCase()}-rec`;
      } else {
        // Mark to market
        const px = await currentPrice(ticker, buy.entryCurrency);
        if (px == null) {
          skipped.push({ ticker, reason: "current price unavailable", generatedAt: buy.generatedAt });
          openPositions.delete(ticker);
          continue;
        }
        exitDate = new Date();
        exitPrice = px;
        exitReason = "open-mtm";
      }
    }

    const shares = perTradeCapital / buy.entryPrice;
    const grossProceeds = shares * exitPrice;
    const pnl$ = grossProceeds - perTradeCapital;
    const pnlPct = ((exitPrice - buy.entryPrice) / buy.entryPrice) * 100;
    const holdMs = new Date(exitDate) - new Date(buy.generatedAt);
    const holdDays = Math.max(1, Math.round(holdMs / (24 * 60 * 60 * 1000)));

    closed.push({
      ticker,
      currency: buy.entryCurrency,
      entryDate: buy.generatedAt,
      entryPrice: buy.entryPrice,
      exitDate,
      exitPrice,
      shares,
      holdDays,
      exitReason,
      pnlDollars: pnl$,
      pnlPct,
      allocatedCapital: perTradeCapital,
      rationale: (buy.rationale || "").slice(0, 200),
    });

    // Close the slot AFTER we've paper-exited — a later BUY on same ticker
    // now becomes eligible.
    openPositions.delete(ticker);
  }

  // Roll up per-currency and total (naive: report USD/CAD separately).
  const usd = closed.filter((t) => t.currency === "USD");
  const cad = closed.filter((t) => t.currency === "CAD");
  const rollupFor = (arr) => {
    if (arr.length === 0) return null;
    const netP = arr.reduce((s, t) => s + t.pnlDollars, 0);
    const allocated = arr.reduce((s, t) => s + t.allocatedCapital, 0);
    return {
      trades: arr.length,
      allocated,
      netPnl: netP,
      returnPct: (netP / allocated) * 100,
      winRate: (arr.filter((t) => t.pnlPct > 0).length / arr.length) * 100,
      avgWinnerPct: arr.filter((t) => t.pnlPct > 0).length ? arr.filter((t) => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0) / arr.filter((t) => t.pnlPct > 0).length : null,
      avgLoserPct: arr.filter((t) => t.pnlPct <= 0).length ? arr.filter((t) => t.pnlPct <= 0).reduce((s, t) => s + t.pnlPct, 0) / arr.filter((t) => t.pnlPct <= 0).length : null,
      avgHoldDays: arr.reduce((s, t) => s + t.holdDays, 0) / arr.length,
    };
  };

  const spy = await spyReturnPct(days);

  const totalAllocated = closed.reduce((s, t) => s + t.allocatedCapital, 0);
  const totalNetPnl = closed.reduce((s, t) => s + t.pnlDollars, 0);
  const capitalReturned = capital + totalNetPnl; // (unallocated cash stayed as cash — zero return, but present)
  const totalReturnPct = (totalNetPnl / capital) * 100;
  const alpha = spy != null ? totalReturnPct - spy : null;

  // Sort trades by absolute P&L contribution for the table.
  closed.sort((a, b) => b.pnlDollars - a.pnlDollars);

  return {
    ok: true,
    windowDays: days,
    startingCapital: capital,
    perTradeCapital,
    maxConcurrent,
    totalRecsInWindow: recs.length,
    buysConsidered: buys.length,
    tradesExecuted: closed.length,
    skipped,
    portfolio: {
      finalValue: capitalReturned,
      totalNetPnl,
      totalReturnPct,
      benchmarkSpyPct: spy,
      alphaPct: alpha,
      cashLeftUninvested: capital - totalAllocated,
    },
    perCurrency: { usd: rollupFor(usd), cad: rollupFor(cad) },
    trades: closed,
    generatedAt: new Date(),
    disclaimer: "PAPER TRADE. Assumes fills at rec price (no slippage), no commissions, no FX conversion cost. Open positions are mark-to-market at CURRENT prices, not window-end. Missed BUYs (all slots full) excluded from returns.",
  };
}
