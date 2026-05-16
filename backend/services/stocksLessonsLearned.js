// backend/services/stocksLessonsLearned.js
//
// Reads the rec history + trade journal + current prices to find recurring
// patterns in the AI's past recommendations — where it's been right, where
// it's been wrong, what the user followed vs skipped. Those patterns get
// injected into future prompts as a TRACK RECORD block so the AI can
// calibrate itself against actual results.
//
// Think of it as the AI getting handed a performance review at the start
// of every shift.

import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const PRICE_CACHE = new Map();
const TTL_MS = 5 * 60 * 1000;

async function fetchPrice(ticker) {
  const now = Date.now();
  const cached = PRICE_CACHE.get(ticker);
  if (cached && now - cached.t < TTL_MS) return cached.price;
  try {
    const r = await fetch(`${YAHOO_BASE}${encodeURIComponent(ticker)}?interval=1d&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate)" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (p) PRICE_CACHE.set(ticker, { price: p, t: now });
    return p;
  } catch { return null; }
}

// Build a comprehensive "lessons" payload. Pulls the last 90 days of recs +
// trades, scores each rec, then groups the data to surface patterns.
export async function computeLessons(email) {
  const since = new Date(Date.now() - 90 * 86400 * 1000);
  const [recs, trades] = await Promise.all([
    StocksAdviceRec.find({ email, generatedAt: { $gte: since } }).lean(),
    StocksTradeJournal.find({ email, executedAt: { $gte: since } }).lean(),
  ]);
  if (recs.length === 0) return null;

  // Index trades by linkedAdviceRecId
  const linkedTrades = new Map();
  for (const t of trades) {
    if (t.linkedAdviceRecId) linkedTrades.set(String(t.linkedAdviceRecId), t);
  }

  // Score each rec
  const tickers = [...new Set(recs.map(r => r.ticker))];
  const priceMap = {};
  await Promise.all(tickers.map(async t => { priceMap[t] = await fetchPrice(t); }));

  const scored = recs.map(r => {
    const followed = linkedTrades.has(String(r._id));
    const cur = priceMap[r.ticker];
    let hypoPnlPct = null;
    if (r.entryPrice && cur) {
      const raw = (cur - r.entryPrice) / r.entryPrice;
      const dir = r.action === "BUY" ? 1 : (r.action === "SELL" || r.action === "TRIM") ? -1 : 0;
      hypoPnlPct = dir * raw * 100;
    }
    return { rec: r, followed, hypoPnlPct, currentPrice: cur };
  });

  // ── Per-ticker hit rate ─────────────────────────────────────────
  const byTicker = new Map();
  for (const s of scored) {
    if (s.hypoPnlPct == null) continue;
    if (!byTicker.has(s.rec.ticker)) byTicker.set(s.rec.ticker, { wins: 0, losses: 0, total: 0, avgPnl: 0, sumPnl: 0 });
    const t = byTicker.get(s.rec.ticker);
    t.total++;
    t.sumPnl += s.hypoPnlPct;
    if (s.hypoPnlPct > 0) t.wins++;
    else if (s.hypoPnlPct < 0) t.losses++;
  }
  for (const t of byTicker.values()) {
    t.avgPnl = t.total > 0 ? t.sumPnl / t.total : 0;
    t.hitRate = t.total > 0 ? (t.wins / t.total) * 100 : 0;
  }

  // Best / worst tickers (min 2 recs to qualify)
  const tickerStats = [...byTicker.entries()]
    .map(([ticker, s]) => ({ ticker, ...s }))
    .filter(s => s.total >= 2);
  const bestTickers = [...tickerStats].sort((a, b) => b.avgPnl - a.avgPnl).slice(0, 3);
  const worstTickers = [...tickerStats].sort((a, b) => a.avgPnl - b.avgPnl).slice(0, 3);

  // ── Per-action hit rate (BUY vs SELL/TRIM) ──────────────────────
  const byAction = { BUY: { wins: 0, total: 0, sumPnl: 0 }, SELL: { wins: 0, total: 0, sumPnl: 0 }, TRIM: { wins: 0, total: 0, sumPnl: 0 } };
  for (const s of scored) {
    if (s.hypoPnlPct == null || !byAction[s.rec.action]) continue;
    byAction[s.rec.action].total++;
    byAction[s.rec.action].sumPnl += s.hypoPnlPct;
    if (s.hypoPnlPct > 0) byAction[s.rec.action].wins++;
  }
  for (const a of Object.keys(byAction)) {
    byAction[a].hitRate = byAction[a].total > 0 ? (byAction[a].wins / byAction[a].total) * 100 : null;
    byAction[a].avgPnl = byAction[a].total > 0 ? byAction[a].sumPnl / byAction[a].total : null;
  }

  // ── Followed-vs-skipped ─────────────────────────────────────────
  const followed = scored.filter(s => s.followed && s.hypoPnlPct != null);
  const skipped = scored.filter(s => !s.followed && s.hypoPnlPct != null);
  const followedAvg = followed.length > 0 ? followed.reduce((a, b) => a + b.hypoPnlPct, 0) / followed.length : null;
  const skippedAvg = skipped.length > 0 ? skipped.reduce((a, b) => a + b.hypoPnlPct, 0) / skipped.length : null;

  // ── Recent-trend hit rate (last 7d, 30d) ────────────────────────
  const trend = {};
  for (const days of [7, 30]) {
    const cutoff = Date.now() - days * 86400 * 1000;
    const window = scored.filter(s => s.hypoPnlPct != null && new Date(s.rec.generatedAt).getTime() >= cutoff);
    if (window.length > 0) {
      const wins = window.filter(s => s.hypoPnlPct > 0).length;
      const avgPnl = window.reduce((a, b) => a + b.hypoPnlPct, 0) / window.length;
      trend[`${days}d`] = { total: window.length, wins, hitRate: (wins / window.length) * 100, avgPnl };
    }
  }

  return {
    totalRecs: recs.length, scoredRecs: scored.filter(s => s.hypoPnlPct != null).length,
    bestTickers, worstTickers, byAction,
    followedAvg, skippedAvg, followedCount: followed.length, skippedCount: skipped.length,
    trend,
  };
}

export function formatLessonsBlock(lessons) {
  if (!lessons || lessons.scoredRecs < 3) return ""; // Need a meaningful sample to comment
  const lines = [];
  lines.push("TRACK RECORD — YOUR PAST RECOMMENDATIONS (last 90 days, mark-to-market):");
  lines.push(`  Scored ${lessons.scoredRecs} of ${lessons.totalRecs} recs (others lack target/stop/cost data).`);

  // Trend
  if (lessons.trend["30d"]) {
    const t = lessons.trend["30d"];
    const tone = t.hitRate >= 60 ? "🟢 strong"
               : t.hitRate >= 40 ? "🟡 mixed"
               : "🔴 weak";
    lines.push(`  Last 30d: ${t.wins}/${t.total} hits (${t.hitRate.toFixed(0)}% hit rate, avg ${t.avgPnl >= 0 ? "+" : ""}${t.avgPnl.toFixed(1)}%) — ${tone}`);
  }
  if (lessons.trend["7d"]) {
    const t = lessons.trend["7d"];
    lines.push(`  Last 7d:  ${t.wins}/${t.total} hits (${t.hitRate.toFixed(0)}%, avg ${t.avgPnl >= 0 ? "+" : ""}${t.avgPnl.toFixed(1)}%)`);
  }

  // Per-action
  const actionLines = [];
  for (const a of ["BUY", "SELL", "TRIM"]) {
    const stats = lessons.byAction[a];
    if (stats.total >= 2) {
      actionLines.push(`${a}: ${stats.wins}/${stats.total} (${stats.hitRate.toFixed(0)}%, avg ${stats.avgPnl >= 0 ? "+" : ""}${stats.avgPnl.toFixed(1)}%)`);
    }
  }
  if (actionLines.length) lines.push(`  By action: ${actionLines.join(" · ")}`);

  // Best tickers
  if (lessons.bestTickers.length > 0) {
    const top = lessons.bestTickers.filter(t => t.avgPnl > 0);
    if (top.length > 0) {
      lines.push(`  ✅ Strongest recs: ${top.map(t => `${t.ticker} (${t.wins}/${t.total}, avg +${t.avgPnl.toFixed(0)}%)`).join(", ")} — lean into these signals.`);
    }
  }
  // Worst tickers
  if (lessons.worstTickers.length > 0) {
    const bot = lessons.worstTickers.filter(t => t.avgPnl < -5);
    if (bot.length > 0) {
      lines.push(`  ❌ Weakest recs: ${bot.map(t => `${t.ticker} (${t.wins}/${t.total}, avg ${t.avgPnl.toFixed(0)}%)`).join(", ")} — be MORE conservative on these (smaller size, tighter stops, or sit out).`);
    }
  }

  // Followed-vs-skipped — is the user a good filter?
  if (lessons.followedCount >= 3 && lessons.skippedCount >= 3) {
    const userFollowEdge = (lessons.followedAvg ?? 0) - (lessons.skippedAvg ?? 0);
    if (userFollowEdge > 3) {
      lines.push(`  📊 User's followed-rec performance: avg +${lessons.followedAvg.toFixed(1)}% vs skipped +${lessons.skippedAvg.toFixed(1)}% — Richard's filter is ADDING value. Trust him to skip recs that don't fit.`);
    } else if (userFollowEdge < -3) {
      lines.push(`  📊 User's followed-rec performance: avg ${lessons.followedAvg.toFixed(1)}% vs skipped ${lessons.skippedAvg.toFixed(1)}% — Richard is skipping winners and following losers. PUSH HARDER on high-conviction recs; don't soften the case.`);
    } else {
      lines.push(`  📊 User follows-vs-skips have similar outcomes (within 3%). The decision filter is neutral.`);
    }
  }

  lines.push("");
  lines.push("How to use this:");
  lines.push("- If overall hit rate is < 40% in the last 30d, your model is mis-calibrated for the current regime. Tighten conviction; require more signal alignment before issuing actionable recs.");
  lines.push("- For 'Weakest recs' tickers, propose smaller positions or skip outright — your past calls there were systematically wrong.");
  lines.push("- For 'Strongest recs' tickers, you have demonstrated edge — full conviction sizing is appropriate.");
  lines.push("- If user's filter is adding value, frame recs as 'consider this' not 'do this' — they're picking the right ones to skip.");
  lines.push("- If user's filter is subtracting value, be more directive — they need help on the close calls.");
  return lines.join("\n");
}
