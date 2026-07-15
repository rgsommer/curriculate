// backend/services/stocksPointInTimeBacktest.js
//
// The honest backtest: for each trading day D in the window, use ONLY
// price/volume data through D to make the picks, then evaluate against
// what actually happened after D. No lookahead — the scoring engine
// sees exactly what it would have seen at 09:15 ET on day D.
//
// Constraints for point-in-time integrity:
//   • Signal set is restricted to OHLC-derived only (technicals, volume,
//     Fib, setups). No MTF (needs live intraday), no catalysts (may
//     include analyst actions from AFTER D), no short interest (bimonthly
//     snapshot may leak future data).
//   • Every decision on day D is fully committed BEFORE seeing day D+1
//     bars. Exit rules are deterministic: target-hit / stop-hit /
//     horizon-exit — all evaluated against ACTUAL forward bars.
//
// Universe: user's portfolio ∪ last 90d recs ∪ default liquid universe
// (same as the forward daily-pick engine — same rules on both sides).

import { computeTechnicalsFromPoints, fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";
import { scoreCandidate } from "./stocksDailyPickEngine.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";

const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "TSLA", "AMD", "NFLX",
  "SPY", "QQQ", "IWM",
];

async function resolveUniverse(email) {
  const u = new Set(DEFAULT_UNIVERSE);
  try {
    const p = await StocksPortfolio.findOne({ email }).select({ "positions.ticker": 1 }).lean();
    for (const pos of p?.positions || []) u.add(String(pos.ticker).toUpperCase().replace(/\..*$/, ""));
  } catch { /* ignore */ }
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recs = await StocksAdviceRec.find({ email, generatedAt: { $gte: since } }).select({ ticker: 1 }).lean().limit(200);
    for (const r of recs) u.add(String(r.ticker).toUpperCase().replace(/\..*$/, ""));
  } catch { /* ignore */ }
  return [...u].slice(0, 60);
}

// Yahoo timestamp is unix seconds. Convert to Date, drop time to UTC-midnight
// so a day comparison is stable regardless of tz.
function tsToYmd(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

// Find the LAST index in points where the bar's date is <= asOfYmd.
// Points come chronologically ascending, so linear from the right.
function indexAsOf(points, asOfYmd) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (tsToYmd(points[i].t) <= asOfYmd) return i;
  }
  return -1;
}

// Given points array and a start index (day of entry), walk forward and
// determine the exit (target-hit / stop-hit / horizon-day close).
function simulateForwardExit(points, entryIdx, entryPrice, targetPrice, stopPrice, horizonDays) {
  let exitIdx = null, exitPrice = null, exitReason = null;
  for (let j = entryIdx + 1; j < points.length && j <= entryIdx + horizonDays; j++) {
    const bar = points[j];
    // Intraday: if the bar's high or low crosses target/stop, we're deemed hit.
    // Stop takes precedence over target if BOTH cross same bar (conservative
    // — assume the bar went down first, hitting stop).
    if (stopPrice != null && bar.low <= stopPrice) { exitIdx = j; exitPrice = stopPrice; exitReason = "stop-hit"; break; }
    if (targetPrice != null && bar.high >= targetPrice) { exitIdx = j; exitPrice = targetPrice; exitReason = "target-hit"; break; }
  }
  if (exitIdx == null) {
    // Horizon-exit at the close of the last available bar within horizon,
    // OR at the last bar we have (if the window we're backtesting doesn't
    // fully cover the horizon — the trade is still "open" in real terms).
    const horizonIdx = Math.min(entryIdx + horizonDays, points.length - 1);
    exitIdx = horizonIdx;
    exitPrice = points[horizonIdx].close;
    exitReason = horizonIdx === entryIdx + horizonDays ? "horizon-exit" : "window-end-open";
  }
  return { exitIdx, exitPrice, exitReason, holdDays: exitIdx - entryIdx };
}

async function spyReturnAcrossWindow(startYmd, endYmd) {
  try {
    const { points } = await fetchDailyOhlcForBacktest("SPY", "USD", 400);
    const startIdx = indexAsOf(points, startYmd);
    const endIdx = indexAsOf(points, endYmd);
    if (startIdx < 0 || endIdx <= startIdx) return null;
    return ((points[endIdx].close - points[startIdx].close) / points[startIdx].close) * 100;
  } catch { return null; }
}

// Trading-day list: pull SPY's 1Y bars and slice their dates to the
// requested window. This handles US market holidays automatically.
async function tradingDaysBetween(startYmd, endYmd) {
  const { points } = await fetchDailyOhlcForBacktest("SPY", "USD", 400);
  const days = [];
  for (const p of points) {
    const ymd = tsToYmd(p.t);
    if (ymd >= startYmd && ymd <= endYmd) days.push(ymd);
  }
  return days;
}

export async function runPointInTimeBacktest({ email, capital = 50000, days = 30, picksPerDay = 2, horizonDays = 10, maxConcurrent = 10 } = {}) {
  const perTradeCapital = capital / maxConcurrent;
  const endD = new Date();
  const startD = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const startYmd = startD.toISOString().slice(0, 10);
  const endYmd = endD.toISOString().slice(0, 10);

  const universe = await resolveUniverse(email);

  // Pre-fetch each ticker's 1Y bars ONCE — huge speedup vs re-fetching per day.
  const barsByTicker = {};
  await Promise.all(universe.map(async (t) => {
    const { points } = await fetchDailyOhlcForBacktest(t, "USD", 400);
    if (points?.length) barsByTicker[t] = points;
  }));

  const tradingDays = await tradingDaysBetween(startYmd, endYmd);
  if (tradingDays.length === 0) return { ok: false, reason: "No trading days in window." };

  const openSlots = new Set(); // ticker (unique — no stacking)
  const trades = [];
  const dayLog = [];

  for (const D of tradingDays) {
    // For each ticker in universe, compute technicals AS OF D and score.
    const scored = [];
    for (const ticker of universe) {
      const points = barsByTicker[ticker];
      if (!points || points.length < 60) continue;
      const asOfIdx = indexAsOf(points, D);
      if (asOfIdx < 60) continue; // need enough history for SMA200 etc.
      const slice = points.slice(0, asOfIdx + 1);
      const tech = computeTechnicalsFromPoints(slice, "USD");
      if (!tech.ok) continue;
      const { score, contributors } = scoreCandidate(tech);
      if (score < 40) continue;
      scored.push({
        ticker,
        asOfIdx,
        entryPrice: tech.last,
        atr14: tech.atr14,
        fib: tech.fib,
        score,
        contributors,
        setups: tech.setups || [],
      });
    }
    scored.sort((a, b) => b.score - a.score);

    // Take top picksPerDay that aren't already open, respecting maxConcurrent.
    const daysPicks = [];
    for (const s of scored) {
      if (daysPicks.length >= picksPerDay) break;
      if (openSlots.has(s.ticker)) continue;
      if (openSlots.size >= maxConcurrent) continue;
      // Compute exit levels using ONLY as-of-D data
      const targetPrice = s.fib?.swingHigh
        ? Math.max(s.entryPrice * 1.02, s.fib.swingHigh)
        : s.atr14 != null ? s.entryPrice + 2 * s.atr14 : s.entryPrice * 1.08;
      const stopPrice = s.atr14 != null ? s.entryPrice - 2.5 * s.atr14 : s.entryPrice * 0.94;

      // Simulate forward on ACTUAL bars — the only lookahead we allow
      // is knowing the day-D close AT day-D-close (standard convention).
      const points = barsByTicker[s.ticker];
      const { exitIdx, exitPrice, exitReason, holdDays } = simulateForwardExit(points, s.asOfIdx, s.entryPrice, targetPrice, stopPrice, horizonDays);
      const pnlPct = ((exitPrice - s.entryPrice) / s.entryPrice) * 100;
      const pnlDollars = perTradeCapital * (exitPrice / s.entryPrice - 1);
      trades.push({
        ticker: s.ticker,
        entryDate: D,
        exitDate: tsToYmd(points[exitIdx].t),
        entryPrice: s.entryPrice,
        exitPrice,
        targetPrice,
        stopPrice,
        holdDays,
        pnlPct,
        pnlDollars,
        exitReason,
        deterministicScore: s.score,
        scoreContributors: s.contributors,
        setupName: (s.setups.find((x) => x.type === "bullish") || {}).name || null,
      });
      daysPicks.push(s.ticker);
      openSlots.add(s.ticker);
      // Remove from openSlots at exit day so a later day can re-enter.
      // Since we walk chronologically, use a simple map:
      // (implicitly handled by looking at completed trades below)
    }
    dayLog.push({ date: D, picks: daysPicks, candidatesAbove40: scored.length });

    // Roll forward — release slots for tickers whose exit date is <= D.
    for (const t of [...openSlots]) {
      const openTrade = trades.filter((tr) => tr.ticker === t).slice(-1)[0];
      if (openTrade && openTrade.exitDate <= D) openSlots.delete(t);
    }
  }

  const netPnl = trades.reduce((s, t) => s + t.pnlDollars, 0);
  const returnPct = (netPnl / capital) * 100;
  const spyPct = await spyReturnAcrossWindow(startYmd, endYmd);
  const alpha = spyPct != null ? returnPct - spyPct : null;

  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null;

  return {
    ok: true,
    windowDays: days,
    startingCapital: capital,
    perTradeCapital,
    picksPerDay,
    horizonDays,
    maxConcurrent,
    universeSize: universe.length,
    tradingDaysProcessed: tradingDays.length,
    tradesExecuted: trades.length,
    portfolio: {
      finalValue: capital + netPnl,
      totalNetPnl: netPnl,
      totalReturnPct: returnPct,
      benchmarkSpyPct: spyPct,
      alphaPct: alpha,
      winRate: trades.length ? (wins.length / trades.length) * 100 : null,
      avgWinnerPct: avg(wins, (t) => t.pnlPct),
      avgLoserPct: avg(losses, (t) => t.pnlPct),
      avgHoldDays: avg(trades, (t) => t.holdDays),
    },
    trades: trades.slice().sort((a, b) => b.pnlDollars - a.pnlDollars),
    dayLog,
    generatedAt: new Date(),
    disclaimer: "POINT-IN-TIME PAPER TRADE. Uses only OHLC-derived signals (technicals, volume, Fib, named setups) — no MTF/catalysts/short-interest (those can't be reconstructed point-in-time). Fills at day-D close, exits at intraday target/stop-hit or horizon-day close. No slippage, no commissions. Trades ending after window are marked window-end-open.",
  };
}
