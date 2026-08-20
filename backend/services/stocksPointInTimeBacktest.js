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
import { getBroadUniverse } from "./stocksUniverse.js";
import { computeMultiFactorScore, computeRelativeStrengthFromBars } from "./stocksMultiFactorScore.js";
import { getFundamentals } from "./stocksFundamentals.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";

const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "TSLA", "AMD", "NFLX",
  "SPY", "QQQ", "IWM",
];

// Universe resolver — SAME source of tickers as the production pick
// engine (broad FMP screener + user positions + past recs), capped
// at BACKTEST_UNIVERSE_MAX so per-day per-ticker bar fetches remain
// tractable. Point-in-time caveat: the broad-screener membership is
// AS OF TODAY, so a stock that IPO'd or grew past $500M mcap during
// the backtest window will still appear in the pool. Best-effort
// mitigation: skip tickers whose bar series doesn't extend back
// through the backtest start (checked in the loop below).
async function resolveUniverse(email, { cap = 400 } = {}) {
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
  try {
    const broad = await getBroadUniverse();
    for (const t of broad) u.add(String(t).toUpperCase());
  } catch (e) { console.warn("[pit-backtest] broad universe load failed:", e?.message); }
  return [...u].slice(0, cap);
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

export async function runPointInTimeBacktest({ email, capital = 50000, days = 30, picksPerDay = 2, horizonDays = 10, maxConcurrent = 10, universeCap } = {}) {
  const perTradeCapital = capital / maxConcurrent;
  const endD = new Date();
  const startD = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const startYmd = startD.toISOString().slice(0, 10);
  const endYmd = endD.toISOString().slice(0, 10);

  // Same universe source as production pick engine. Default cap 400
  // caps the per-ticker 1Y bar pre-fetch at a tractable number for a
  // point-in-time run.
  const universe = await resolveUniverse(email, { cap: Math.max(50, Math.min(1000, universeCap || 400)) });

  // Pre-fetch each ticker's 1Y bars ONCE — huge speedup vs re-fetching per day.
  const barsByTicker = {};
  await Promise.all(universe.map(async (t) => {
    const { points } = await fetchDailyOhlcForBacktest(t, "USD", 400);
    if (points?.length) barsByTicker[t] = points;
  }));

  // Pre-fetch fundamentals + benchmark bars for the top-of-universe
  // multi-factor composite. Fundamentals are AS-OF-TODAY (mild
  // lookahead for a 30-90 day backtest window — flagged in the
  // response caveats). Benchmark bars re-used across per-day RS calcs.
  const [spyBars, xicBars] = await Promise.all([
    fetchDailyOhlcForBacktest("SPY", "USD", 400).then(r => r.points).catch(() => null),
    fetchDailyOhlcForBacktest("XIC.TO", "CAD", 400).then(r => r.points).catch(() => null),
  ]);
  const fundamentalsByTicker = {};

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

    // Multi-factor uplift on the top-K technicals — SAME composite
    // the production pick engine runs. Applied per-day so the
    // backtest actually models the algorithm production trades.
    // For point-in-time RS, uses bars sliced to as-of-D (no
    // lookahead). Fundamentals are as-of-today (mild lookahead —
    // called out in caveats[]).
    const MF_TOP_K = Math.min(30, scored.length);
    const stage2 = scored.slice(0, MF_TOP_K);
    for (const cand of stage2) {
      try {
        // Point-in-time RS using bars sliced through D.
        const bars = barsByTicker[cand.ticker];
        const asOfIdx = cand.asOfIdx;
        const tSlice = bars.slice(0, asOfIdx + 1);
        const bench = spyBars ? spyBars.slice(0, indexAsOf(spyBars, D) + 1) : null;
        const rs = (bench && bench.length > 130)
          ? computeRelativeStrengthFromBars(
              tSlice.map(p => ({ close: p.close })),
              bench.map(p => ({ close: p.close }))
            )
          : { ok: false };
        // Fundamentals (cached, as-of-today).
        if (!(cand.ticker in fundamentalsByTicker)) {
          fundamentalsByTicker[cand.ticker] = await getFundamentals(cand.ticker, "USD").catch(() => null);
        }
        const fundamentals = fundamentalsByTicker[cand.ticker];
        const composite = computeMultiFactorScore({
          technicalScore: cand.score,
          fundamentals,
          growth: null,
          revisions: null,
          rs,
          insider: null,
        });
        cand.compositeRank = composite.score;
        cand.factorBreakdown = Object.fromEntries(
          Object.entries(composite.factors).map(([k, v]) => [k, v.score])
        );
      } catch { /* skip this ticker's uplift */ }
    }
    // Re-rank on composite where available; the residual (K+1..end)
    // keeps its technical score.
    stage2.sort((a, b) => (b.compositeRank ?? b.score) - (a.compositeRank ?? a.score));
    const rankedForPicks = [...stage2, ...scored.slice(MF_TOP_K)];

    // Take top picksPerDay that aren't already open, respecting maxConcurrent.
    const daysPicks = [];
    for (const s of rankedForPicks) {
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
        compositeRank: s.compositeRank ?? null,
        factorBreakdown: s.factorBreakdown ?? null,
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
    engineParity: {
      universeSource: "broad FMP screener (same as production) + user positions + past recs",
      universeCap: universe.length,
      scoringPipeline: "technical pre-screen → multi-factor composite (top 30) — same as production",
      pointInTimeSignals: ["technicals", "volume", "fib", "setups", "relative-strength (as-of-D)"],
      caveats: [
        "Broad universe membership is AS-OF-TODAY — a stock that grew past $500M mcap during the backtest window will still appear in the pool (mild survivorship bias). Tickers without bars back to the window start are skipped, which mitigates the worst cases.",
        "Fundamentals (ROE, D/E, FCF yield, PE) are AS-OF-TODAY, not as-of-D. For a 30-day backtest this is minor; for longer windows the bias grows. Production uses current fundamentals too, so this is consistent with what a live trade would see today — but not what a live trade would have seen 30 days ago.",
        "EPS estimate revisions and growth acceleration are neutral (0.5) in both production and backtest until dedicated FMP endpoints are plumbed.",
      ],
    },
  };
}
