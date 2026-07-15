// backend/services/stocksTradeJournalAnalysis.js
//
// AI pattern learning over the user's own closed trades. Reads their
// full StocksTradeJournal, pairs BUY/SELL legs into closed round trips
// (FIFO), computes per-trade metrics (P&L, hold length, ticker, sector),
// aggregates rollups (win rate, best/worst hold band, best/worst sector),
// then asks Anthropic to find the patterns THIS USER wins and loses on.
//
// Personal compounding edge — nothing generic gives it.
//
// Costs: one Sonnet call (~2500 tokens) per analysis, cached until the
// user records a new trade. Cheap.

import StocksTradeJournal from "../models/StocksTradeJournal.js";

const MODEL = process.env.STOCKS_JOURNAL_ANALYSIS_MODEL || "claude-sonnet-4-6";

// ── FIFO position pairing ───────────────────────────────────────────
// Walk each ticker's leg-level history in time order. BUYs open lots
// (FIFO queue); SELLs close them oldest-first. Returns an array of
// closed round trips: {ticker, entryDate, exitDate, entryPx, exitPx,
// shares, holdDays, currency, gainPct, gainDollars, notes[]}.
function buildClosedTrades(trades) {
  // Flatten: one row per leg (with executedAt + notes attached).
  const rows = [];
  for (const t of trades) {
    for (const l of t.legs || []) {
      if (l.side !== "BUY" && l.side !== "SELL") continue;
      rows.push({
        executedAt: t.executedAt,
        side: l.side,
        ticker: l.ticker,
        shares: l.shares || 0,
        price: l.pricePerShare || 0,
        currency: l.currency,
        notes: t.notes || "",
        linkedAdviceRecId: t.linkedAdviceRecId || null,
      });
    }
  }
  rows.sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));

  const closed = [];
  const openLots = {}; // ticker → [{executedAt, shares, price, currency, notes}, ...]

  for (const r of rows) {
    if (!r.ticker || !(r.shares > 0) || !(r.price > 0)) continue;
    if (r.side === "BUY") {
      if (!openLots[r.ticker]) openLots[r.ticker] = [];
      openLots[r.ticker].push({ ...r });
    } else if (r.side === "SELL") {
      let toClose = r.shares;
      const q = openLots[r.ticker] || [];
      while (toClose > 0 && q.length > 0) {
        const lot = q[0];
        const closeShares = Math.min(toClose, lot.shares);
        const holdMs = new Date(r.executedAt) - new Date(lot.executedAt);
        const holdDays = Math.max(1, Math.round(holdMs / (24 * 60 * 60 * 1000)));
        const gainDollars = (r.price - lot.price) * closeShares;
        const gainPct = ((r.price - lot.price) / lot.price) * 100;
        closed.push({
          ticker: r.ticker,
          entryDate: lot.executedAt,
          exitDate: r.executedAt,
          entryPx: lot.price,
          exitPx: r.price,
          shares: closeShares,
          currency: r.currency,
          holdDays,
          gainPct,
          gainDollars,
          notes: [lot.notes, r.notes].filter(Boolean).join(" · "),
        });
        lot.shares -= closeShares;
        toClose -= closeShares;
        if (lot.shares <= 0.0001) q.shift();
      }
      // Any SELL beyond open lots is a short entry we don't yet model — skip.
    }
  }
  return closed.sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate));
}

// ── Rollups the AI reads ─────────────────────────────────────────────
function computeRollups(closed) {
  if (closed.length === 0) return null;
  const winners = closed.filter((t) => t.gainPct > 0);
  const losers = closed.filter((t) => t.gainPct <= 0);
  const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0);

  // Hold-length buckets
  const buckets = [
    { label: "≤3d (day/very short)", min: 0, max: 3 },
    { label: "4-10d (short swing)", min: 4, max: 10 },
    { label: "11-30d (swing)", min: 11, max: 30 },
    { label: "31-90d (position)", min: 31, max: 90 },
    { label: "90d+ (long)", min: 91, max: Infinity },
  ];
  const byHold = buckets.map((b) => {
    const g = closed.filter((t) => t.holdDays >= b.min && t.holdDays <= b.max);
    return {
      band: b.label,
      count: g.length,
      winRate: g.length ? (g.filter((t) => t.gainPct > 0).length / g.length) * 100 : null,
      avgGainPct: g.length ? avg(g, (t) => t.gainPct) : null,
    };
  }).filter((b) => b.count > 0);

  // By ticker
  const byTickerMap = {};
  for (const t of closed) {
    if (!byTickerMap[t.ticker]) byTickerMap[t.ticker] = [];
    byTickerMap[t.ticker].push(t);
  }
  const byTicker = Object.entries(byTickerMap)
    .map(([ticker, arr]) => ({
      ticker,
      count: arr.length,
      winRate: (arr.filter((t) => t.gainPct > 0).length / arr.length) * 100,
      avgGainPct: avg(arr, (t) => t.gainPct),
      netDollars: arr.reduce((s, t) => s + t.gainDollars, 0),
    }))
    .sort((a, b) => b.netDollars - a.netDollars);

  return {
    totalTrades: closed.length,
    winRate: (winners.length / closed.length) * 100,
    avgWinnerPct: avg(winners, (t) => t.gainPct),
    avgLoserPct: avg(losers, (t) => t.gainPct),
    biggestWin: closed.slice().sort((a, b) => b.gainPct - a.gainPct)[0],
    biggestLoss: closed.slice().sort((a, b) => a.gainPct - b.gainPct)[0],
    netDollarsTotal: closed.reduce((s, t) => s + t.gainDollars, 0),
    avgHoldDays: avg(closed, (t) => t.holdDays),
    byHoldBand: byHold,
    byTicker: byTicker.slice(0, 15), // top 15 tickers by net $
  };
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = await r.json();
  return j?.content?.[0]?.text || "";
}

export async function analyzeTradeJournal({ email, minClosedTrades = 5 } = {}) {
  const trades = await StocksTradeJournal.find({ email }).lean();
  if (trades.length === 0) return { ok: false, reason: "No trades in journal yet." };

  const closed = buildClosedTrades(trades);
  if (closed.length < minClosedTrades) {
    return { ok: false, reason: `Need at least ${minClosedTrades} closed round-trips to find patterns. You have ${closed.length}.`, closedCount: closed.length };
  }

  const rollups = computeRollups(closed);

  // Send the last 40 closed trades verbatim (with notes) so the AI can
  // spot patterns in the setups themselves, not just aggregates.
  const detail = closed.slice(0, 40).map((t) => {
    const dir = t.gainPct > 0 ? "WIN" : "LOSS";
    return `${dir} · ${t.ticker} · entry ${new Date(t.entryDate).toISOString().slice(0, 10)} @$${t.entryPx.toFixed(2)} · exit ${new Date(t.exitDate).toISOString().slice(0, 10)} @$${t.exitPx.toFixed(2)} · held ${t.holdDays}d · ${t.gainPct >= 0 ? "+" : ""}${t.gainPct.toFixed(1)}% ($${t.gainDollars.toFixed(0)} ${t.currency})${t.notes ? ` — notes: "${t.notes.slice(0, 120)}"` : ""}`;
  }).join("\n");

  const rollupText = [
    `Total closed trades: ${rollups.totalTrades} · Win rate: ${rollups.winRate.toFixed(0)}% · Net $: ${rollups.netDollarsTotal.toFixed(0)}`,
    `Avg winner: +${rollups.avgWinnerPct.toFixed(1)}% · Avg loser: ${rollups.avgLoserPct.toFixed(1)}%`,
    `Avg hold: ${rollups.avgHoldDays.toFixed(0)} days`,
    `Biggest win: ${rollups.biggestWin.ticker} +${rollups.biggestWin.gainPct.toFixed(1)}% in ${rollups.biggestWin.holdDays}d`,
    `Biggest loss: ${rollups.biggestLoss.ticker} ${rollups.biggestLoss.gainPct.toFixed(1)}% in ${rollups.biggestLoss.holdDays}d`,
    "",
    `Win rate by hold band:`,
    ...rollups.byHoldBand.map((b) => `  ${b.band}: ${b.count} trades · ${b.winRate?.toFixed(0)}% win · avg ${b.avgGainPct >= 0 ? "+" : ""}${b.avgGainPct?.toFixed(1)}%`),
    "",
    `Top tickers by net $:`,
    ...rollups.byTicker.slice(0, 10).map((t) => `  ${t.ticker}: ${t.count} trades · ${t.winRate.toFixed(0)}% win · ${t.avgGainPct >= 0 ? "+" : ""}${t.avgGainPct.toFixed(1)}% avg · $${t.netDollars.toFixed(0)} net`),
  ].join("\n");

  const prompt = `You are a senior trading coach reviewing THIS INDIVIDUAL trader's closed-trade history. Do NOT give generic advice. Do NOT lecture. Find SPECIFIC patterns in THEIR data.

═══════ AGGREGATE ROLLUPS ═══════
${rollupText}

═══════ LAST 40 CLOSED TRADES ═══════
${detail}

═══════ YOUR TASK ═══════
Read the data. Find real, specific, non-obvious patterns. Then return ONLY this JSON (no prose, no code fences):

{
  "winningPatterns": ["pattern 1 with specific numbers", "pattern 2 with specific numbers", "pattern 3 with specific numbers"],
  "losingPatterns": ["pattern 1 with specific numbers", "pattern 2 with specific numbers"],
  "hiddenStrength": "1-2 sentences: a specific edge the trader may not realize they have (specific tickers/hold-lengths/setups)",
  "hiddenWeakness": "1-2 sentences: a specific leak the trader may not realize is costing them",
  "concreteRecommendations": [
    "1 specific rule change with a numbered threshold, e.g. 'cut losers at −8% instead of −15% — your data shows losses > −12% never recover'",
    "another specific rule",
    "another specific rule"
  ],
  "personalEdgeSummary": "2-3 sentence executive summary of this trader's edge and where they should concentrate"
}

RULES:
- Cite SPECIFIC numbers from the data (win rates, hold lengths, tickers, %s). Vague findings ("you should diversify") are useless.
- If the data is too thin to conclude something, say so explicitly.
- The trader wants to know what THEY win on, not general trading wisdom.
- No hedging platitudes. Be direct.`;

  const text = await callAnthropic(prompt);
  const parsed = extractJson(text);
  if (!parsed) return { ok: false, reason: "AI response could not be parsed.", rollups, closedTradesCount: closed.length };

  return {
    ok: true,
    analyzedAt: new Date(),
    closedTradesCount: closed.length,
    rollups,
    recentClosed: closed.slice(0, 40),
    analysis: {
      winningPatterns: Array.isArray(parsed.winningPatterns) ? parsed.winningPatterns.slice(0, 6) : [],
      losingPatterns: Array.isArray(parsed.losingPatterns) ? parsed.losingPatterns.slice(0, 6) : [],
      hiddenStrength: String(parsed.hiddenStrength || "").slice(0, 500),
      hiddenWeakness: String(parsed.hiddenWeakness || "").slice(0, 500),
      concreteRecommendations: Array.isArray(parsed.concreteRecommendations) ? parsed.concreteRecommendations.slice(0, 8) : [],
      personalEdgeSummary: String(parsed.personalEdgeSummary || "").slice(0, 700),
    },
  };
}
