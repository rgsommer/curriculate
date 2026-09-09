// backend/services/stocksPositionLedger.js
//
// P3.5 (2026-09-09) — reconstruct the canonical position performance
// ledger from existing trade / rec / snapshot data. FIFO round-trip
// matching; every row stamps dataQuality ∈ {COMPLETE, PARTIAL, UNATTRIBUTABLE}.
// Never fabricates missing detail.
//
// P3.5 change vs P3:
//   • CAD P&L uses the FULL-VALUE method via computeCadPnl(). For a USD
//     name held by a CAD investor: PnL = shares × exitPriceUsd × exitFx
//                                       − shares × entryPriceUsd × entryFx
//                                       − feesCad
//     — NOT (native gain × exit FX), which was quietly wrong when FX
//     moved between entry and exit.
//   • Fees are ATTRIBUTED PER LEG via estimateLegFee + aggregateFees.
//     Each row stamps feeSource ∈ {ACTUAL, ESTIMATED, UNKNOWN} and
//     feeEstimateMethod for auditability.
//   • FX decomposition (localReturnPct + fxReturnPct + interactionPct)
//     comes from computeCadPnl and reconciles exactly to the combined
//     CAD return within floating-point noise.
//
// Callers: buildPortfolioLedger({ email }) → { rows, coverage }.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksPositionLedgerEntry from "../models/StocksPositionLedgerEntry.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";
import { pickBenchmarkFor, getMatchedReturnPct, getMatchedAlphaPct } from "./stocksBenchmarkMatched.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { computeCadPnl } from "./stocksFxDecomposition.js";
import { estimateLegFee, aggregateFees } from "./stocksFeeAttribution.js";

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
      // Estimate per-leg fee using per-broker default. actualFeeNative
      // wins when present; TradeJournal doesn't persist it today, so
      // most rows will stamp feeSource = ESTIMATED.
      const brokerCode = (t.account || "").toLowerCase().startsWith("questrade") ? "questrade"
                       : (t.account || "").toLowerCase().startsWith("cibc") ? "cibc-ie" : null;
      const feeInfo = estimateLegFee({ side: leg.side, currency: leg.currency }, {
        brokerCode,
        actualFeeNative: Number.isFinite(leg.commission) ? leg.commission
                       : Number.isFinite(leg.feeNative) ? leg.feeNative : undefined,
        actualFeeCurrency: leg.feeCurrency || leg.currency,
      });
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
        feeInfo,
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

        // Full-value CAD PnL via P3.5 FX decomposition. When FX is
        // missing for USD legs, computeCadPnl returns nulls with
        // note:"missing-fx" — the row is stamped PARTIAL below.
        const fees = aggregateFees(
          [buy.feeInfo, leg.feeInfo],
          { fxUsdCad: leg.fxUsdCad || buy.fxUsdCad || 1.37 },
        );
        const pnl = computeCadPnl({
          shares: closed,
          entryPriceNative: buy.price,
          exitPriceNative: leg.price,
          currency: buy.currency,
          entryFxCadPerUsd: buy.currency === "CAD" ? 1 : buy.fxUsdCad,
          exitFxCadPerUsd: buy.currency === "CAD" ? 1 : leg.fxUsdCad,
          feesCad: fees.totalCad || 0,
        });
        const realizedNative = (leg.price - buy.price) * closed - (buy.feeInfo?.feeNative || 0) - (leg.feeInfo?.feeNative || 0);
        const holdingPeriodDays = Math.max(0, Math.round((new Date(leg.when) - new Date(buy.when)) / 86400000));
        const isPartial = closed < buy.shares;
        const sleeve = classifyPosition({ ticker: buy.ticker });

        // Data quality — if USD leg without FX, or PnL couldn't be
        // computed cleanly, degrade to PARTIAL and record missing.
        const missing = [];
        let quality = "COMPLETE";
        if (buy.currency === "USD" && !(buy.fxUsdCad > 0)) { missing.push("entryFx"); quality = "PARTIAL"; }
        if (buy.currency === "USD" && !(leg.fxUsdCad > 0)) { missing.push("exitFx"); quality = "PARTIAL"; }
        if (!(pnl.realizedPnLCad != null)) { missing.push("realizedPnLCad"); quality = "PARTIAL"; }

        rows.push({
          email, ticker: buy.ticker, account: buy.account, sleeve,
          entryDate: new Date(buy.when),
          entryPrice: buy.price, entryShares: closed,
          entryCurrency: buy.currency, entryFx: buy.fxUsdCad,
          exitDate: new Date(leg.when),
          exitPrice: leg.price, exitShares: closed, exitFx: leg.fxUsdCad,
          entryValueCad: pnl.entryValueCad, exitValueCad: pnl.exitValueCad,
          realizedPnLNative: realizedNative,
          realizedPnLCad: pnl.realizedPnLCad,
          unrealizedPnLNative: null, unrealizedPnLCad: null,
          feesEstimatedNative: (buy.feeInfo?.feeNative || 0) + (leg.feeInfo?.feeNative || 0),
          feesCad: fees.totalCad,
          feeSource: fees.worstSource,
          feeEstimateMethods: [buy.feeInfo?.feeEstimateMethod, leg.feeInfo?.feeEstimateMethod].filter(Boolean),
          holdingPeriodDays,
          recommendationId: buy.recommendationId || null,
          isOpen: false, isPartial,
          brokerRef: `${buy.tradeRef}::${leg.tradeRef}::${closed}`,
          dataQuality: quality,
          missingFields: missing,
          localReturnPct: pnl.localReturnPct,
          fxReturnPct: pnl.fxReturnPct,
          interactionPct: pnl.interactionPct,
          combinedCadReturnPct: pnl.combinedCadReturnPct,
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
          feesEstimatedNative: leg.feeInfo?.feeNative || 0,
          feesCad: (leg.feeInfo?.feeCurrency === "CAD" ? leg.feeInfo?.feeNative : (leg.feeInfo?.feeNative || 0) * (leg.fxUsdCad || 1.37)),
          feeSource: leg.feeInfo?.feeSource || "UNKNOWN",
          feeEstimateMethods: leg.feeInfo?.feeEstimateMethod ? [leg.feeInfo.feeEstimateMethod] : [],
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
    // Any remaining openBuys → open positions. mark unrealized via
    // computeCadPnl too, using a synthetic exit at priceNow + entryFx
    // (no realized FX gain when unrealized — mark to market at entry FX
    // avoids double-counting FX until the position closes).
    for (const { leg: buy, remainingShares } of openBuys) {
      let priceNow = null;
      try {
        const bars = await fetchYahooDaily(buy.ticker, "1mo");
        priceNow = Array.isArray(bars) && bars.length > 0 ? bars[bars.length - 1].close : null;
      } catch { priceNow = null; }
      const sleeve = classifyPosition({ ticker: buy.ticker });
      let unrealizedPnLCad = null, entryValueCad = null, exitValueCad = null;
      let localReturnPct = null, fxReturnPct = null, interactionPct = null, combinedCadReturnPct = null;
      if (Number.isFinite(priceNow)) {
        const pnl = computeCadPnl({
          shares: remainingShares,
          entryPriceNative: buy.price,
          exitPriceNative: priceNow,
          currency: buy.currency,
          entryFxCadPerUsd: buy.currency === "CAD" ? 1 : buy.fxUsdCad,
          exitFxCadPerUsd: buy.currency === "CAD" ? 1 : buy.fxUsdCad, // mark unrealized FX at entry
          feesCad: (buy.feeInfo?.feeCurrency === "CAD" ? buy.feeInfo?.feeNative : (buy.feeInfo?.feeNative || 0) * (buy.fxUsdCad || 1.37)),
        });
        unrealizedPnLCad = pnl.realizedPnLCad;
        entryValueCad = pnl.entryValueCad;
        exitValueCad = pnl.exitValueCad;
        localReturnPct = pnl.localReturnPct;
        fxReturnPct = pnl.fxReturnPct;
        interactionPct = pnl.interactionPct;
        combinedCadReturnPct = pnl.combinedCadReturnPct;
      }
      const unrealizedNative = Number.isFinite(priceNow) ? (priceNow - buy.price) * remainingShares : null;
      rows.push({
        email, ticker: buy.ticker, account: buy.account, sleeve,
        entryDate: new Date(buy.when),
        entryPrice: buy.price, entryShares: remainingShares,
        entryCurrency: buy.currency, entryFx: buy.fxUsdCad,
        exitDate: null, exitPrice: null, exitShares: null, exitFx: null,
        entryValueCad, exitValueCad,
        realizedPnLNative: null, realizedPnLCad: null,
        unrealizedPnLNative: unrealizedNative,
        unrealizedPnLCad,
        feesEstimatedNative: buy.feeInfo?.feeNative || 0,
        feesCad: (buy.feeInfo?.feeCurrency === "CAD" ? buy.feeInfo?.feeNative : (buy.feeInfo?.feeNative || 0) * (buy.fxUsdCad || 1.37)),
        feeSource: buy.feeInfo?.feeSource || "UNKNOWN",
        feeEstimateMethods: buy.feeInfo?.feeEstimateMethod ? [buy.feeInfo.feeEstimateMethod] : [],
        holdingPeriodDays: Math.max(0, Math.round((priceAsOf - new Date(buy.when)) / 86400000)),
        recommendationId: buy.recommendationId || null,
        isOpen: true, isPartial: false,
        brokerRef: `${buy.tradeRef}::open::${remainingShares}`,
        dataQuality: Number.isFinite(priceNow) ? "COMPLETE" : "PARTIAL",
        missingFields: Number.isFinite(priceNow) ? [] : ["priceNow"],
        localReturnPct, fxReturnPct, interactionPct, combinedCadReturnPct,
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
      // Security return: in NATIVE currency (matches benchmark's own
      // currency by construction — pickBenchmarkFor uses a same-ccy
      // proxy). This isolates selection alpha from FX.
      const secReturn = (() => {
        if (row.isOpen) {
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
