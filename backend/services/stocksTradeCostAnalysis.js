// backend/services/stocksTradeCostAnalysis.js
//
// Trade Cost Analysis (TCA) — measures execution quality on the user's
// own recorded trades. Pros do this and quietly discover they're
// giving up 20-40 bps at the open by using market orders.
//
// Method (simple, defensible, cheap):
//   For each trade:
//     - Fetch the day's OHLC bar for the ticker
//     - Typical price ≈ (High + Low + Close) / 3   ← VWAP proxy
//     - For BUY:  slippage_bps = (fill - typical) / typical × 10000
//                 positive = paid too much
//     - For SELL: slippage_bps = (typical - fill) / typical × 10000
//                 positive = sold too cheap
//   Bucket by hour-of-day in ET so the trader can see whether their
//   09:30 market orders systematically underperform their 11:00 or
//   GTC-limit fills.
//
// Deliberately does NOT use true intraday VWAP (would require paid
// tick-level data). The (H+L+C)/3 proxy is standard for after-the-fact
// TCA on daily-bar data and correlates ~0.9 with true VWAP.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import { fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";

// Convert an executedAt timestamp to a market-hour bucket in ET.
// Buckets: pre-open (< 09:30), open-30 (09:30–09:59), mid-morn
// (10:00–10:59), midday (11:00–14:59), close-hour (15:00–15:59),
// after-hours (>=16:00).
function hourBucket(executedAt) {
  try {
    const d = new Date(executedAt);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const h = parseInt(fmt.find(p => p.type === "hour")?.value || "0", 10);
    const m = parseInt(fmt.find(p => p.type === "minute")?.value || "0", 10);
    if (h < 9 || (h === 9 && m < 30)) return "pre-open";
    if (h === 9) return "open-30";
    if (h === 10) return "mid-morn";
    if (h < 15) return "midday";
    if (h === 15) return "close-hour";
    return "after-hours";
  } catch { return "unknown"; }
}

const BUCKETS_ORDERED = ["pre-open", "open-30", "mid-morn", "midday", "close-hour", "after-hours", "unknown"];

// Analyse every trade in the last N days. Returns { perTrade, byBucket,
// summary, sampleSize }.
export async function analyseTradeCosts(email, days = 365) {
  const since = new Date(Date.now() - days * 86400000);
  const trades = await StocksTradeJournal.find({
    email, executedAt: { $gte: since },
  }).sort({ executedAt: -1 }).lean();
  if (trades.length === 0) return { perTrade: [], byBucket: [], summary: null, sampleSize: 0 };

  // Group trades by ticker+ISO-date so we fetch OHLC once per (ticker, day).
  const bars = new Map(); // key `${ticker}|${YYYY-MM-DD}` → typical price
  const uniqueFetches = new Map(); // ticker → set of YYYY-MM-DD
  for (const t of trades) {
    const day = new Date(t.executedAt).toISOString().slice(0, 10);
    for (const leg of t.legs || []) {
      if (!leg.ticker) continue;
      const tk = String(leg.ticker).toUpperCase();
      if (!uniqueFetches.has(tk)) uniqueFetches.set(tk, new Set());
      uniqueFetches.get(tk).add(day);
    }
  }
  // Fetch daily OHLC per ticker (400 days is plenty for a 365-day
  // window). Cached inside stocksTechnicals so repeat runs are cheap.
  const perTicker = {};
  const tickers = [...uniqueFetches.keys()];
  await Promise.all(tickers.slice(0, 40).map(async (tk) => {
    // Guess currency from ticker suffix — .TO/.V/.NE/.CN → CAD, else USD.
    const ccy = /\.(TO|V|NE|CN)$/i.test(tk) ? "CAD" : "USD";
    try {
      const { points } = await fetchDailyOhlcForBacktest(tk, ccy, 400);
      const idx = {};
      for (const p of (points || [])) {
        const day = new Date(p.date).toISOString().slice(0, 10);
        if (Number.isFinite(p.high) && Number.isFinite(p.low) && Number.isFinite(p.close)) {
          idx[day] = (p.high + p.low + p.close) / 3;
        }
      }
      perTicker[tk] = idx;
    } catch { perTicker[tk] = {}; }
  }));

  const perTrade = [];
  const bucketAcc = new Map();
  for (const t of trades) {
    const day = new Date(t.executedAt).toISOString().slice(0, 10);
    const bucket = hourBucket(t.executedAt);
    for (const leg of t.legs || []) {
      if (!leg.ticker || !Number.isFinite(leg.pricePerShare) || leg.pricePerShare <= 0) continue;
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      const tk = String(leg.ticker).toUpperCase();
      const typical = perTicker[tk]?.[day];
      if (!Number.isFinite(typical) || typical <= 0) continue;
      const slippageBps = leg.side === "BUY"
        ? ((leg.pricePerShare - typical) / typical) * 10000
        : ((typical - leg.pricePerShare) / typical) * 10000;
      const notionalCcy = leg.pricePerShare * (leg.shares || 0);
      const slippageDollarsCcy = slippageBps / 10000 * notionalCcy;
      perTrade.push({
        tradeId: String(t._id),
        executedAt: t.executedAt,
        bucket, day, side: leg.side, ticker: tk,
        shares: leg.shares,
        fillPrice: leg.pricePerShare,
        typicalPrice: typical,
        currency: leg.currency,
        notionalCcy,
        slippageBps,
        slippageDollarsCcy,
      });
      if (!bucketAcc.has(bucket)) bucketAcc.set(bucket, { bucket, trades: 0, buys: 0, sells: 0, slippages: [], notionalTotal: 0, slippageDollarsTotal: 0 });
      const row = bucketAcc.get(bucket);
      row.trades++;
      if (leg.side === "BUY") row.buys++; else row.sells++;
      row.slippages.push(slippageBps);
      row.notionalTotal += notionalCcy;
      row.slippageDollarsTotal += slippageDollarsCcy;
    }
  }

  const median = (arr) => {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const byBucket = BUCKETS_ORDERED
    .map(b => bucketAcc.get(b))
    .filter(Boolean)
    .map(r => ({
      bucket: r.bucket,
      trades: r.trades, buys: r.buys, sells: r.sells,
      avgSlippageBps: r.slippages.reduce((s, x) => s + x, 0) / r.trades,
      medianSlippageBps: median(r.slippages),
      minSlippageBps: Math.min(...r.slippages),
      maxSlippageBps: Math.max(...r.slippages),
      totalSlippageDollars: r.slippageDollarsTotal,
      totalNotional: r.notionalTotal,
    }));

  const allSlippages = perTrade.map(t => t.slippageBps);
  const summary = allSlippages.length ? {
    trades: allSlippages.length,
    avgSlippageBps: allSlippages.reduce((s, x) => s + x, 0) / allSlippages.length,
    medianSlippageBps: median(allSlippages),
    totalSlippageDollars: perTrade.reduce((s, t) => s + t.slippageDollarsCcy, 0),
    bestBucket: byBucket.slice().sort((a, b) => a.avgSlippageBps - b.avgSlippageBps)[0]?.bucket || null,
    worstBucket: byBucket.slice().sort((a, b) => b.avgSlippageBps - a.avgSlippageBps)[0]?.bucket || null,
  } : null;

  return {
    windowDays: days,
    sampleSize: allSlippages.length,
    tickersFetched: tickers.length,
    perTrade: perTrade.slice(0, 100),
    byBucket,
    summary,
    caveat: "Slippage measured against day's typical price ((H+L+C)/3) as a VWAP proxy — correlates ~0.9 with true intraday VWAP but can miss micro-structure like the open-print jitter or the last-minute cross.",
  };
}
