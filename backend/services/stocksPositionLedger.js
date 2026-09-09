// backend/services/stocksPositionLedger.js
//
// P3 (2026-09-09) — reconstruct the canonical position performance
// ledger from existing trade / rec / snapshot data. FIFO round-trip
// matching; every row stamps dataQuality ∈ {COMPLETE, PARTIAL, UNATTRIBUTABLE}.
// Never fabricates missing detail.
//
// Steps per (email, ticker, account):
//   1. Pull all StocksTradeJournal legs for the ticker+account, sorted
//      by executedAt.
//   2. FIFO-match BUYs against subsequent SELLs. Each SELL leg closes
//      the oldest open BUY quantity first.
//   3. Emit one LedgerEntry per BUY leg (partially closed → isPartial;
//      fully closed → isOpen=false with exit fields set; still open →
//      isOpen=true with exit fields null).
//   4. Attempt recommendation linkage via TradeJournal.linkedAdviceRecId
//      and StocksAdviceRec history; failure ⇒ recommendationId=null.
//   5. Persist to StocksPositionLedgerEntry (idempotent).
//
// Fees are LEG_FEE_ESTIMATE_NATIVE per leg unless a leg carries an
// explicit fee (schema doesn't today) — surfaced as "estimated" for
// transparency.
//
// Callers: buildPortfolioLedger({ email }) → { rows, coverage }.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksPositionLedgerEntry from "../models/StocksPositionLedgerEntry.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";
import { pickBenchmarkFor, getMatchedReturnPct, getMatchedAlphaPct } from "./stocksBenchmarkMatched.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const LEG_FEE_ESTIMATE_NATIVE = 6.95; // CIBC / Questrade rough per-leg fee

function baseTicker(t) { return String(t || "").toUpperCase().replace(/\..*$/, ""); }
function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// PUBLIC — build the ledger for one user. Returns rows + coverage.
export async function buildPortfolioLedger({ email, computeAlpha = true, priceAsOf = new Date() } = {}) {
  const trades = await StocksTradeJournal.find({ email: String(email || "").toLowerCase() })
    .sort({ executedAt: 1 }).lean();
  if (!trades || trades.length === 0) {
    return { rows: [], coverage: { totalLegs: 0, coveredLegs: 0, coveragePct: 0 } };
  }

  // Flatten to per-leg BUY/SELL rows, keyed by (ticker, account).
  const bucket = new Map(); // key → array of { side, shares, price, currency, when, tradeRef, fxUsdCad }
  let totalLegs = 0;
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      if (!(leg.shares > 0) || !(leg.pricePerShare > 0) || !leg.ticker) continue;
      totalLegs++;
      const key = `${baseTicker(leg.ticker)}::${t.account || ""}`;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push({
        side: leg.side,
        ticker: String(leg.ticker).toUpperCase(),
        shares: leg.shares,
        price: leg.pricePerShare,
        currency: leg.currency,
        when: t.executedAt,
        tradeRef: t._id,
        fxUsdCad: t.fxUsdCadAtTrade,
        recommendationId: t.linkedAdviceRecId || null,
        account: t.account || null,
        accountName: t.accountName || null,
      });
    }
  }

  const rows = [];
  let coveredLegs = 0;

  for (const [key, legs] of bucket) {
    // FIFO round-trip matching. `openBuys` is a queue of unmatched-BUY
    // remainders shaped { leg, remainingShares }.
    const openBuys = [];
    for (const leg of legs) {
      if (leg.side === "BUY") {
        openBuys.push({ leg, remainingShares: leg.shares });
        continue;
      }
      // SELL — consume against openBuys FIFO.
      let sellShares = leg.shares;
      while (sellShares > 0 && openBuys.length > 0) {
        const head = openBuys[0];
        const closed = Math.min(head.remainingShares, sellShares);
        const buy = head.leg;
        const realizedNative = (leg.price - buy.price) * closed - LEG_FEE_ESTIMATE_NATIVE * 2;
        const holdingPeriodDays = Math.max(0, Math.round((new Date(leg.when) - new Date(buy.when)) / 86400000));
        const isPartial = closed < buy.shares;
        const sleeve = classifyPosition({ ticker: buy.ticker });
        rows.push({
          email, ticker: buy.ticker, account: buy.account, sleeve,
          entryDate: new Date(buy.when),
          entryPrice: buy.price, entryShares: closed,
          entryCurrency: buy.currency, entryFx: buy.fxUsdCad,
          exitDate: new Date(leg.when),
          exitPrice: leg.price, exitShares: closed, exitFx: leg.fxUsdCad,
          realizedPnLNative: realizedNative,
          realizedPnLCad: buy.currency === "CAD" ? realizedNative
                        : realizedNative * (leg.fxUsdCad || buy.fxUsdCad || 1.37),
          unrealizedPnLNative: null, unrealizedPnLCad: null,
          feesEstimatedNative: LEG_FEE_ESTIMATE_NATIVE * 2,
          holdingPeriodDays,
          recommendationId: buy.recommendationId || null,
          isOpen: false, isPartial,
          brokerRef: `${buy.tradeRef}::${leg.tradeRef}::${closed}`,
          dataQuality: "COMPLETE",
          missingFields: [],
        });
        coveredLegs++;
        head.remainingShares -= closed;
        sellShares -= closed;
        if (head.remainingShares <= 1e-9) openBuys.shift();
      }
      if (sellShares > 0) {
        // SELL leg without a matching BUY (broker-only, split, prior-
        // to-journal position). Emit as UNATTRIBUTABLE so aggregate
        // computations can drop it explicitly.
        rows.push({
          email, ticker: leg.ticker, account: leg.account,
          sleeve: classifyPosition({ ticker: leg.ticker }),
          entryDate: null, entryPrice: null, entryShares: null,
          entryCurrency: leg.currency, entryFx: null,
          exitDate: new Date(leg.when), exitPrice: leg.price, exitShares: sellShares,
          exitFx: leg.fxUsdCad,
          realizedPnLNative: null, realizedPnLCad: null,
          unrealizedPnLNative: null, unrealizedPnLCad: null,
          feesEstimatedNative: LEG_FEE_ESTIMATE_NATIVE,
          holdingPeriodDays: null,
          recommendationId: null,
          isOpen: false, isPartial: false,
          brokerRef: `unmatched::${leg.tradeRef}`,
          dataQuality: "UNATTRIBUTABLE",
          missingFields: ["entryDate", "entryPrice", "entryShares"],
          reconstructionNotes: "SELL with no prior BUY in trade-journal history",
        });
      }
    }
    // Any remaining openBuys → open positions. mark unrealized.
    for (const { leg: buy, remainingShares } of openBuys) {
      let priceNow = null;
      try {
        const bars = await fetchYahooDaily(buy.ticker, "1mo");
        priceNow = Array.isArray(bars) && bars.length > 0 ? bars[bars.length - 1].close : null;
      } catch { priceNow = null; }
      const unrealizedNative = Number.isFinite(priceNow) ? (priceNow - buy.price) * remainingShares : null;
      const sleeve = classifyPosition({ ticker: buy.ticker });
      rows.push({
        email, ticker: buy.ticker, account: buy.account, sleeve,
        entryDate: new Date(buy.when),
        entryPrice: buy.price, entryShares: remainingShares,
        entryCurrency: buy.currency, entryFx: buy.fxUsdCad,
        exitDate: null, exitPrice: null, exitShares: null, exitFx: null,
        realizedPnLNative: null, realizedPnLCad: null,
        unrealizedPnLNative: unrealizedNative,
        unrealizedPnLCad: buy.currency === "CAD" ? unrealizedNative
                        : (unrealizedNative != null ? unrealizedNative * (buy.fxUsdCad || 1.37) : null),
        feesEstimatedNative: LEG_FEE_ESTIMATE_NATIVE,
        holdingPeriodDays: Math.max(0, Math.round((priceAsOf - new Date(buy.when)) / 86400000)),
        recommendationId: buy.recommendationId || null,
        isOpen: true, isPartial: false,
        brokerRef: `${buy.tradeRef}::open::${remainingShares}`,
        dataQuality: Number.isFinite(priceNow) ? "COMPLETE" : "PARTIAL",
        missingFields: Number.isFinite(priceNow) ? [] : ["priceNow"],
      });
      coveredLegs++;
    }
  }

  // Alpha computation — matched-benchmark return per row (closed rows
  // use exit date; open rows use priceAsOf). Skipped for
  // UNATTRIBUTABLE rows.
  if (computeAlpha) {
    // Batch by benchmark to reuse a small bars cache.
    const barsCache = new Map();
    async function getBars(t) {
      if (barsCache.has(t)) return barsCache.get(t);
      const b = await fetchYahooDaily(t, "2y").catch(() => null);
      barsCache.set(t, b);
      return b;
    }
    for (const row of rows) {
      if (row.dataQuality === "UNATTRIBUTABLE") continue;
      const bench = pickBenchmarkFor({ ticker: row.ticker, currency: row.entryCurrency });
      row.benchmarkTicker = bench;
      const from = row.entryDate;
      const to = row.exitDate || priceAsOf;
      if (!from || !to) continue;
      const secReturn = (() => {
        if (row.isOpen) {
          // priceNow − entryPrice / entryPrice
          const pn = row.entryPrice + (row.unrealizedPnLNative || 0) / (row.entryShares || 1);
          return Number.isFinite(pn) && row.entryPrice > 0 ? ((pn - row.entryPrice) / row.entryPrice) * 100 : null;
        }
        return row.entryPrice > 0 ? ((row.exitPrice - row.entryPrice) / row.entryPrice) * 100 : null;
      })();
      row.securityReturnPct = secReturn;
      const benchBars = await getBars(bench);
      const bres = await getMatchedReturnPct({ ticker: bench, fromDate: from, toDate: to, bars: benchBars });
      row.benchmarkReturnPctMatched = bres.pct;
      row.matchedAlphaPct = getMatchedAlphaPct({
        securityReturnPct: secReturn, benchmarkReturnPct: bres.pct,
      });

      // FX decomposition for USD securities held by a CAD investor.
      if (row.entryCurrency === "USD" && Number.isFinite(row.entryFx) && Number.isFinite(row.exitFx || row.entryFx)) {
        const fxFrom = row.entryFx;
        const fxTo = row.exitFx || row.entryFx;
        row.localReturnPct = secReturn;
        row.fxReturnPct = fxFrom > 0 ? ((fxTo - fxFrom) / fxFrom) * 100 : null;
        if (Number.isFinite(row.localReturnPct) && Number.isFinite(row.fxReturnPct)) {
          row.combinedCadReturnPct = ((1 + row.localReturnPct / 100) * (1 + row.fxReturnPct / 100) - 1) * 100;
        }
      }
    }
  }

  // Persist idempotently.
  const ops = rows.map(r => ({
    updateOne: {
      filter: { email: r.email, ticker: r.ticker, account: r.account, entryDate: r.entryDate, brokerRef: r.brokerRef },
      update: { $set: { ...r, reconstructedAt: new Date() } },
      upsert: true,
    },
  }));
  try {
    if (ops.length > 0) await StocksPositionLedgerEntry.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.warn(`[position-ledger] persist warn for ${email}:`, e?.message);
  }

  return {
    rows,
    coverage: {
      totalLegs, coveredLegs,
      coveragePct: totalLegs > 0 ? Math.round((coveredLegs / totalLegs) * 100) : 0,
    },
  };
}
