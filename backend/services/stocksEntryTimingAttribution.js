// backend/services/stocksEntryTimingAttribution.js
//
// P3.5 (2026-09-09) — real entry-timing attribution. Answers:
//   "Did the recommendation entry level get us in cleanly, or did we
//    chase after the stock had already run?"
//
// For every BUY trade linked to a recommendation:
//   • recommendationTime, recommendationRefPrice   (from StocksAdviceRec)
//   • actualFillTime, actualFillPrice              (from StocksTradeJournal)
//   • sameDayClose, nextDayOpen, nextDayClose,
//     threeDayDelayedClose                         (from Yahoo daily bars)
//
// Metrics:
//   entrySlippagePct = (actualFill − recRef) / recRef × 100
//   sameDayCloseVsRec, nextDayOpenVsRec, nextDayCloseVsRec, delay3dVsRec
//     — each expressed as percent difference from the rec ref price.
//
// Descriptive classification (spec §3 — NEVER treated as additive):
//   BETTER_THAN_REC_ENTRY  — actual fill ≤ recRef (bought at or better)
//   CHASED_HIGHER          — actual fill > recRef by ≥ +0.75% AND
//                             sameDayClose > recRef by similar
//   NEUTRAL                — small slippage, ambiguous direction
//   DELAY_HELPED           — 3-day delayed close < actual fill
//   DELAY_HURT             — 3-day delayed close > actual fill
//
// Reports COVERAGE % — fraction of BUY trades with a linked rec AND
// enough Yahoo bars to compute all the metrics.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }
function pctDiff(a, b) { return (Number.isFinite(a) && Number.isFinite(b) && b !== 0) ? ((a - b) / b) * 100 : null; }

function classify({ entrySlippagePct, delay3dCloseVsFill }) {
  if (!Number.isFinite(entrySlippagePct)) return "NEUTRAL";
  if (entrySlippagePct <= 0) return "BETTER_THAN_REC_ENTRY";
  if (entrySlippagePct >= 0.75) return "CHASED_HIGHER";
  if (Number.isFinite(delay3dCloseVsFill)) {
    if (delay3dCloseVsFill <= -1) return "DELAY_HELPED"; // holding off would have caught it cheaper
    if (delay3dCloseVsFill >=  1) return "DELAY_HURT";
  }
  return "NEUTRAL";
}

// Locate a bar's close by ymd. Falls back to next available bar.
function closeAtOrAfter(bars, targetYmd) {
  if (!Array.isArray(bars)) return null;
  const found = bars.find(b => (b.date || "").slice(0, 10) >= targetYmd);
  return found ? Number(found.close) : null;
}
function openAtOrAfter(bars, targetYmd) {
  if (!Array.isArray(bars)) return null;
  const found = bars.find(b => (b.date || "").slice(0, 10) >= targetYmd);
  return found ? Number(found.open) : null;
}
function nthTradingDayAfter(bars, fromYmd, n) {
  if (!Array.isArray(bars)) return null;
  const idx = bars.findIndex(b => (b.date || "").slice(0, 10) >= fromYmd);
  if (idx < 0) return null;
  const nb = bars[idx + n];
  return nb ? Number(nb.close) : null;
}

// PUBLIC — compute the attribution across all linked BUY trades in a window.
export async function computeEntryTimingAttribution({ email, fromYmd, toYmd }) {
  const trades = await StocksTradeJournal.find({
    email: String(email || "").toLowerCase(),
    executedAt: { $gte: new Date(fromYmd), $lte: new Date(toYmd + "T23:59:59Z") },
  }).sort({ executedAt: 1 }).lean();

  const buys = [];
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (leg.side !== "BUY" || !leg.ticker || !(leg.pricePerShare > 0)) continue;
      buys.push({
        ticker: leg.ticker, pricePerShare: leg.pricePerShare, currency: leg.currency,
        executedAt: t.executedAt, recommendationId: t.linkedAdviceRecId || null,
      });
    }
  }
  const totalBuys = buys.length;
  const linked = buys.filter(b => b.recommendationId);
  const perTrade = [];

  // Pre-fetch bars per ticker.
  const barsCache = new Map();
  async function bars(t) {
    if (barsCache.has(t)) return barsCache.get(t);
    const b = await fetchYahooDaily(t, "1y").catch(() => null);
    barsCache.set(t, b);
    return b;
  }

  for (const b of linked) {
    const rec = await StocksAdviceRec.findById(b.recommendationId).lean().catch(() => null);
    if (!rec || !(rec.entryPrice > 0)) continue;
    const yb = await bars(b.ticker);
    if (!Array.isArray(yb)) continue;
    const fillYmd = ymd(b.executedAt);
    const nextDayYmd = ymd(new Date(new Date(fillYmd).getTime() + 86400_000));
    const sameDayClose = closeAtOrAfter(yb, fillYmd);
    const nextDayOpen = openAtOrAfter(yb, nextDayYmd);
    const nextDayClose = closeAtOrAfter(yb, nextDayYmd);
    const delay3dClose = nthTradingDayAfter(yb, fillYmd, 3);
    const row = {
      ticker: b.ticker,
      recommendationId: String(b.recommendationId),
      recommendedAt: rec.generatedAt || rec.createdAt || null,
      recommendationRefPrice: rec.entryPrice,
      actualFillTime: b.executedAt,
      actualFillPrice: b.pricePerShare,
      entrySlippagePct: pctDiff(b.pricePerShare, rec.entryPrice),
      sameDayCloseVsRecPct: pctDiff(sameDayClose, rec.entryPrice),
      nextDayOpenVsRecPct: pctDiff(nextDayOpen, rec.entryPrice),
      nextDayCloseVsRecPct: pctDiff(nextDayClose, rec.entryPrice),
      delay3dCloseVsRecPct: pctDiff(delay3dClose, rec.entryPrice),
      delay3dCloseVsFillPct: pctDiff(delay3dClose, b.pricePerShare),
    };
    row.classification = classify({
      entrySlippagePct: row.entrySlippagePct,
      delay3dCloseVsFill: row.delay3dCloseVsFillPct,
    });
    perTrade.push(row);
  }

  const eligible = perTrade.length;
  const coveragePct = totalBuys > 0 ? Math.round((eligible / totalBuys) * 100) : 0;
  const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  const slippages = perTrade.map(r => r.entrySlippagePct).filter(Number.isFinite);
  const clsCounts = {};
  for (const r of perTrade) clsCounts[r.classification] = (clsCounts[r.classification] || 0) + 1;
  return {
    coverage: {
      totalBuys, linkedBuys: linked.length, eligibleBuys: eligible, coveragePct,
    },
    meanSlippagePct: mean(slippages),
    medianSlippagePct: (() => {
      if (slippages.length === 0) return null;
      const s = [...slippages].sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
    })(),
    classificationCounts: clsCounts,
    perTrade,
    note: "Entry-timing metrics are DESCRIPTIVE — never added to the portfolio contribution waterfall.",
  };
}
