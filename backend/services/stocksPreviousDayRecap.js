// backend/services/stocksPreviousDayRecap.js
//
// Deterministic previous-day portfolio recap (2026-09-02). Explains
// what happened yesterday and WHY, at a glance, without an LLM call.
//
// The user's ask: "It would also be nice to have an indication of how
// the previous trading day was in terms of explaining the results and
// commenting on why it is what it is."
//
// This is a deterministic block — it reads:
//   • StocksPortfolioSnapshot (yesterday's portfolio total vs day before)
//   • Yahoo daily bars for held tickers (per-position % move)
//   • Benchmark bars (SPY / QQQ / XIC.TO) for market context
//   • StocksAdviceRec transitions since last briefing (target/stop/horizon hits)
//   • StocksEightK filings on held tickers (Item 1.01 M&A, item 5.02
//     leadership changes, etc.) — hard signal for individual-name moves
//
// Renders as a §A0 "Yesterday's tape" section in both AI-mode and
// deterministic-mode briefings.

import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksEightK from "../models/StocksEightK.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Format a signed pct with sign + 1 decimal.
function fmtPct(v) {
  if (!Number.isFinite(v)) return "n/a";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}
function fmtDollar(v, currency = "CAD") {
  if (!Number.isFinite(v)) return "n/a";
  const s = v >= 0 ? "+" : "−";
  return `${s}$${Math.abs(v).toLocaleString("en-CA", { maximumFractionDigits: 0 })} ${currency}`;
}

// Most recent trading day return from a Yahoo daily series (using
// last two bar closes). Returns null if bars unavailable.
function lastBarReturnPct(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const last = bars[bars.length - 1]?.close;
  const prev = bars[bars.length - 2]?.close;
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

// Yesterday's portfolio total vs the day before, from the persisted
// snapshot series. Returns {yesterdayCad, dayBeforeCad, deltaCad,
// deltaPct, yesterdayDate} or null when snapshots insufficient.
async function portfolioDelta(email) {
  try {
    const rows = await StocksPortfolioSnapshot.find({
      email: String(email).toLowerCase(),
      accountId: "__total__",
    }).sort({ date: -1 }).limit(2).lean();
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const [latest, prior] = rows;
    if (!Number.isFinite(latest?.totalCad) || !Number.isFinite(prior?.totalCad) || prior.totalCad <= 0) return null;
    const deltaCad = latest.totalCad - prior.totalCad;
    const deltaPct = (deltaCad / prior.totalCad) * 100;
    return {
      yesterdayDate: latest.date,
      yesterdayCad: latest.totalCad,
      dayBeforeCad: prior.totalCad,
      deltaCad,
      deltaPct,
    };
  } catch { return null; }
}

// Fetch benchmark closes (SPY/QQQ/XIC) via Yahoo daily bars.
async function benchmarkMoves() {
  const symbols = ["SPY", "QQQ", "XIC.TO"];
  const out = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const bars = await fetchYahooDaily(sym, "5d");
      const r = lastBarReturnPct(bars);
      if (r != null) out[sym] = r;
    } catch { /* soft-fail per-symbol */ }
  }));
  return out;
}

// Per-position daily moves + rank top-3 gainers / top-3 losers.
// Reads Yahoo daily bars for each held ticker; caps universe to
// avoid a huge scan for portfolios with many positions.
async function perPositionMoves(positions, { limit = 30 } = {}) {
  if (!Array.isArray(positions) || positions.length === 0) return { moves: [], gainers: [], losers: [] };
  const held = positions.filter(p => (p?.qty || 0) > 0).slice(0, limit);
  const moves = [];
  const CONC = 6;
  for (let i = 0; i < held.length; i += CONC) {
    const slice = held.slice(i, i + CONC);
    await Promise.all(slice.map(async (p) => {
      try {
        const bars = await fetchYahooDaily(p.ticker, "5d");
        const returnPct = lastBarReturnPct(bars);
        if (returnPct == null) return;
        // Dollar impact — use the most recent price times qty as the
        // stake; %move × stake = daily $ P&L.
        const last = bars[bars.length - 1]?.close;
        const stakeCcy = Number.isFinite(last) ? last * (p.qty || 0) : null;
        const dailyPnl = stakeCcy != null ? stakeCcy * (returnPct / 100) : null;
        moves.push({
          ticker: p.ticker,
          returnPct,
          stake: stakeCcy,
          dailyPnl,
          currency: p.ccy || (String(p.ticker).endsWith(".TO") ? "CAD" : "USD"),
        });
      } catch { /* soft-fail */ }
    }));
  }
  const sorted = [...moves].sort((a, b) => b.returnPct - a.returnPct);
  const gainers = sorted.slice(0, 3);
  const losers = sorted.slice(-3).reverse();
  return { moves, gainers, losers };
}

// Rec transitions in the last 24h — target/stop hits or horizon
// expirations that happened since the previous briefing.
async function recTransitions(email) {
  try {
    const since = new Date(Date.now() - DAY_MS);
    return await StocksAdviceRec.find({
      email: String(email).toLowerCase(),
      status: { $in: ["target-hit", "stop-hit", "expired"] },
      hitAt: { $gte: since },
    })
      .select({ ticker: 1, action: 1, status: 1, hitPrice: 1, hitAt: 1, entryPrice: 1, lastPnlPct: 1 })
      .sort({ hitAt: -1 })
      .limit(20)
      .lean();
  } catch { return []; }
}

// 8-K filings on held tickers in the last 24-48h — hard signal for
// individual-name moves that isn't just noise. Item 1.01 = definitive
// material agreement (often M&A); 5.02 = leadership change; 2.02 =
// earnings; 7.01 = Reg FD disclosure.
async function heldEightKs(positions) {
  const bases = (positions || [])
    .filter(p => (p?.qty || 0) > 0)
    .map(p => String(p.ticker).toUpperCase().replace(/\..*$/, ""));
  if (bases.length === 0) return [];
  try {
    const since = new Date(Date.now() - 2 * DAY_MS);
    return await StocksEightK.find({
      ticker: { $in: bases },
      filedAt: { $gte: since },
    })
      .select({ ticker: 1, filedAt: 1, itemNumbers: 1, itemLabels: 1, url: 1 })
      .sort({ filedAt: -1 })
      .limit(15)
      .lean();
  } catch { return []; }
}

// Attach an English reason for a per-position move by cross-referencing
// 8-K filings and daily-range vs benchmark. Kept deliberately simple —
// deterministic reasons only (no LLM). Returns a short string or null.
function reasonFor(move, benchmarkMoves, eightKs) {
  if (!move) return null;
  const bench = benchmarkMoves.SPY;
  const relToMarket = Number.isFinite(bench) ? move.returnPct - bench : null;
  const base = String(move.ticker).toUpperCase().replace(/\..*$/, "");
  const filings = (eightKs || []).filter(k => k.ticker === base);
  // 8-K reason wins — hard corporate-action signal.
  if (filings.length > 0) {
    const items = filings[0].itemLabels?.join(" · ") || filings[0].itemNumbers?.join(", ") || "8-K filing";
    return `8-K filed (${items})`;
  }
  // Otherwise, describe move relative to market
  if (Number.isFinite(relToMarket)) {
    if (Math.abs(relToMarket) < 0.3) return "moved with the market";
    if (relToMarket > 0) return `outperformed market by ${fmtPct(relToMarket)}`;
    return `underperformed market by ${fmtPct(relToMarket)}`;
  }
  return null;
}

// Main entry — assembles the whole recap payload. Consumed by the
// briefing renderer (via formatPreviousDayRecap below).
//
// Fast fail: any bad data path returns null. The renderer treats null
// as "recap unavailable" and skips the section — never blocks the
// briefing.
export async function buildPreviousDayRecap({ email, positions = [] } = {}) {
  const t0 = Date.now();
  try {
    const [delta, marks, moves, transitions, eightKs] = await Promise.all([
      portfolioDelta(email),
      benchmarkMoves(),
      perPositionMoves(positions),
      recTransitions(email),
      heldEightKs(positions),
    ]);
    return {
      email,
      generatedAt: new Date(),
      portfolio: delta,
      benchmarks: marks,
      moves: moves.moves,
      gainers: moves.gainers,
      losers: moves.losers,
      recTransitions: transitions,
      eightKs,
      elapsedMs: Date.now() - t0,
    };
  } catch (e) {
    console.warn("[previous-day-recap] build failed:", e?.message);
    return null;
  }
}

// Render the recap as a markdown block for the briefing. Fits at the
// top of the "portfolio state" section — read as "what happened
// yesterday" before the "what to do today" mandates.
export function formatPreviousDayRecap(recap) {
  if (!recap) return "";
  const lines = [];
  lines.push("");
  lines.push("## 📊 Yesterday's tape");
  lines.push("");
  // Portfolio-level headline
  if (recap.portfolio) {
    const dp = recap.portfolio;
    const marketContext = recap.benchmarks.SPY != null
      ? ` · SPY ${fmtPct(recap.benchmarks.SPY)}${recap.benchmarks["XIC.TO"] != null ? ` · XIC ${fmtPct(recap.benchmarks["XIC.TO"])}` : ""}`
      : "";
    lines.push(`**Portfolio ${dp.yesterdayDate}: ${fmtDollar(dp.deltaCad)} (${fmtPct(dp.deltaPct)})**${marketContext}`);
    // Contextualize vs SPY
    if (Number.isFinite(recap.benchmarks.SPY)) {
      const delta = dp.deltaPct - recap.benchmarks.SPY;
      const rel = Math.abs(delta) < 0.15 ? "in line with the market"
        : delta > 0 ? `outperformed SPY by ${fmtPct(delta)}`
        : `underperformed SPY by ${fmtPct(delta)}`;
      lines.push(`_You ${rel}._`);
    }
    lines.push("");
  } else {
    lines.push(`_Insufficient snapshot history to compute yesterday's portfolio move (need 2+ snapshots)._`);
    lines.push("");
  }

  // Top gainers with reasons
  if (recap.gainers?.length > 0) {
    lines.push(`**Top movers up**`);
    for (const g of recap.gainers.filter(x => x.returnPct > 0.1)) {
      const reason = reasonFor(g, recap.benchmarks, recap.eightKs);
      const pnl = Number.isFinite(g.dailyPnl) ? ` · ${fmtDollar(g.dailyPnl, g.currency)}` : "";
      lines.push(`- **${g.ticker}** ${fmtPct(g.returnPct)}${pnl}${reason ? ` — ${reason}` : ""}`);
    }
    lines.push("");
  }

  // Top losers with reasons — mirror image
  if (recap.losers?.length > 0) {
    const losers = recap.losers.filter(x => x.returnPct < -0.1);
    if (losers.length > 0) {
      lines.push(`**Top movers down**`);
      for (const l of losers) {
        const reason = reasonFor(l, recap.benchmarks, recap.eightKs);
        const pnl = Number.isFinite(l.dailyPnl) ? ` · ${fmtDollar(l.dailyPnl, l.currency)}` : "";
        lines.push(`- **${l.ticker}** ${fmtPct(l.returnPct)}${pnl}${reason ? ` — ${reason}` : ""}`);
      }
      lines.push("");
    }
  }

  // Rec transitions — target/stop/horizon hits since last briefing
  if (recap.recTransitions?.length > 0) {
    lines.push(`**Rec events (last 24h)**`);
    for (const r of recap.recTransitions) {
      const outcome = r.status === "target-hit" ? "🎯 target hit"
        : r.status === "stop-hit" ? "🛑 stop hit"
        : "⏳ horizon expired";
      const pnl = Number.isFinite(r.lastPnlPct) ? ` · ${fmtPct(r.lastPnlPct)}` : "";
      lines.push(`- ${r.action} **${r.ticker}** — ${outcome} @ $${(r.hitPrice || 0).toFixed(2)}${pnl}`);
    }
    lines.push("");
  }

  // 8-K filings on held tickers — corporate-action ticker tape
  const heldFilings = (recap.eightKs || []).filter(k => {
    // Only surface ones actually held (perPositionMoves included them).
    const base = String(k.ticker).toUpperCase();
    return (recap.moves || []).some(m => String(m.ticker).toUpperCase().replace(/\..*$/, "") === base);
  });
  if (heldFilings.length > 0) {
    lines.push(`**Corporate events on your holdings**`);
    for (const k of heldFilings.slice(0, 5)) {
      const items = k.itemLabels?.join(" · ") || k.itemNumbers?.join(", ") || "8-K";
      const when = k.filedAt ? new Date(k.filedAt).toISOString().slice(0, 10) : "";
      lines.push(`- **${k.ticker}** — ${items}${when ? ` (${when})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
