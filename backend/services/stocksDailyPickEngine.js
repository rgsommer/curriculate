// backend/services/stocksDailyPickEngine.js
//
// Picks the top N candidates for the forced-daily-pick discipline. Runs
// AT DECISION TIME (weekday morning cron) — no lookahead concern here
// because "now" is genuinely now. The concern the harness protects
// against is not lookahead but SURVIVORSHIP: every pick this engine
// makes gets persisted and tracked to close, even the losers.
//
// Scoring is deterministic + transparent so we can audit later. No
// LLM judgment involved.

import { getTechnicals } from "./stocksTechnicals.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";

// A small hand-curated universe of large-cap liquid US names for cases
// when the user's own portfolio + recent recs give too few candidates.
// Not "the best stocks" — just "always-tradeable defaults" so the cron
// never has to skip a day due to empty universe. Overridden by the
// user's actual portfolio + recent research pool when available.
const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "TSLA", "AMD", "NFLX",
  "SPY", "QQQ", "IWM",
];

function pctBetween(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

// Deterministic composite from OHLC-derived signals only.
//   +Trend: SMA50 above SMA200 & price above SMA50 (0-25)
//   +Momentum: RSI 50-65 sweet spot (0-15)
//   +Volume: RVOL > 1.5 OR pocket pivot OR OBV accumulation (0-15)
//   +Setup: named setup present (VCP/bull flag/coiled spring/inside-day) (0-25)
//   +MTF: aligned up (0-15) — requires opts.includeMultiTimeframe upstream
//   -Kill: RSI > 75 (overbought), price below SMA50 (downtrend) — subtract 30
function scoreCandidate(tech) {
  if (!tech?.ok) return { score: 0, contributors: ["tech unavailable"] };
  let score = 0;
  const contributors = [];
  const add = (pts, why) => { score += pts; if (pts > 0) contributors.push(`${why} +${pts}`); else if (pts < 0) contributors.push(`${why} ${pts}`); };

  // Trend
  if (tech.sma50 && tech.sma200 && tech.last) {
    if (tech.sma50 > tech.sma200 && tech.priceVsSma50 >= 0) add(25, `trend up (SMA50>SMA200, price +${tech.priceVsSma50.toFixed(1)}% > SMA50)`);
    else if (tech.priceVsSma50 >= 0) add(10, `above SMA50 but SMA50<SMA200`);
  }

  // Momentum
  if (tech.rsi14 != null) {
    if (tech.rsi14 >= 50 && tech.rsi14 <= 65) add(15, `RSI ${tech.rsi14.toFixed(0)} sweet spot`);
    else if (tech.rsi14 >= 40 && tech.rsi14 < 50) add(7, `RSI ${tech.rsi14.toFixed(0)} recovering`);
    else if (tech.rsi14 > 65 && tech.rsi14 <= 75) add(3, `RSI ${tech.rsi14.toFixed(0)} elevated`);
    else if (tech.rsi14 > 75) add(-30, `RSI ${tech.rsi14.toFixed(0)} OVERBOUGHT — killed`);
  }

  // Volume
  if (tech.volume?.rvol >= 1.5) add(8, `RVOL ${tech.volume.rvol.toFixed(2)}x`);
  if (tech.volume?.pocketPivot) add(10, `pocket pivot`);
  if (tech.volume?.obvTrend === "accumulation") add(4, `OBV accumulation`);

  // Setup — take the strongest bullish setup's score contribution
  const bullSetup = (tech.setups || []).find((s) => s.type === "bullish");
  if (bullSetup) add(Math.min(25, Math.round(bullSetup.score / 4)), `${bullSetup.name} (${bullSetup.score})`);

  // MTF
  if (tech.mtf?.confluence === "aligned" && tech.mtf.direction === "up") add(15, `MTF aligned up`);
  else if (tech.mtf?.confluence === "aligned" && tech.mtf.direction === "down") add(-15, `MTF aligned DOWN — killed`);
  else if (tech.mtf?.confluence === "conflicting") add(-5, `MTF conflicting`);

  // Kill: price below SMA50 = downtrend
  if (tech.priceVsSma50 != null && tech.priceVsSma50 < -3) add(-20, `below SMA50 (${tech.priceVsSma50.toFixed(1)}%)`);

  return { score: Math.max(0, Math.min(100, Math.round(score))), contributors };
}

async function resolveUniverseForUser(email) {
  const universe = new Set(DEFAULT_UNIVERSE);
  // User's current portfolio positions
  try {
    const p = await StocksPortfolio.findOne({ email }).select({ "positions.ticker": 1, "positions.currency": 1 }).lean();
    for (const pos of p?.positions || []) {
      const t = String(pos.ticker || "").toUpperCase();
      if (t) universe.add(t);
    }
  } catch { /* ignore */ }
  // Recent high-conviction discovery picks (last 60d) — a research-vetted pool
  try {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const cands = await StocksDiscoveryCandidate.find({ email, scanDate: { $gte: since } }).select({ ticker: 1 }).lean().limit(60);
    for (const c of cands) universe.add(String(c.ticker).toUpperCase());
  } catch { /* ignore */ }
  // Tickers the AI has already recommended in last 90d (fair game — they're
  // known to us and we're not selecting from a broader survivorship-biased set)
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recs = await StocksAdviceRec.find({ email, generatedAt: { $gte: since } }).select({ ticker: 1 }).lean().limit(200);
    for (const r of recs) universe.add(String(r.ticker).toUpperCase());
  } catch { /* ignore */ }
  return [...universe].slice(0, 80);
}

// Pick top N (default 2) — the honest discipline that this feature exists to
// enforce. Returns an array (possibly empty if no candidate scored > 40).
export async function generateDailyPicksForUser({ email, n = 2, minScore = 40, currency = "USD" } = {}) {
  const universe = await resolveUniverseForUser(email);
  const scored = [];

  for (const ticker of universe) {
    try {
      const tech = await getTechnicals(ticker, currency, { includeMultiTimeframe: true });
      if (!tech?.ok || tech.last == null) continue;
      const { score, contributors } = scoreCandidate(tech);
      if (score < minScore) continue;
      const bullSetup = (tech.setups || []).find((s) => s.type === "bullish");
      // Entry = current close. Target = swing high or +2×ATR. Stop = 2.5×ATR below.
      const target = tech.fib?.swingHigh
        ? Math.max(tech.last * 1.02, tech.fib.swingHigh)
        : tech.atr14 != null ? tech.last + 2 * tech.atr14 : tech.last * 1.08;
      const stop = tech.suggested25AtrStop != null && tech.suggested25AtrStop > 0
        ? tech.suggested25AtrStop
        : tech.last * 0.94;
      scored.push({
        ticker,
        entryPrice: tech.last,
        targetPrice: target,
        stopPrice: stop,
        deterministicScore: score,
        scoreContributors: contributors,
        setupName: bullSetup?.name || null,
        mtfConfluence: tech.mtf?.confluence || null,
        atr14: tech.atr14,
        rationale: `Composite ${score}: ${contributors.slice(0, 3).join(" · ")}${bullSetup ? ` · setup: ${bullSetup.name}` : ""}${tech.mtf?.confluence === "aligned" ? " · MTF aligned" : ""}`,
      });
    } catch { /* skip this ticker this tick */ }
  }

  scored.sort((a, b) => b.deterministicScore - a.deterministicScore);
  return scored.slice(0, n);
}

export { scoreCandidate }; // exported for Test B reuse
