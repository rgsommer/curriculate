// backend/jobs/stocksEodRecap.js
//
// End-of-day recap. Fires 4:15 PM ET weekdays (15 min after close so
// end-of-session data settles). One short email per user, structured as:
//
//   1. What FILLED today (BUY/SELL legs from the trade journal)
//   2. What STOPPED today (auto-sell-trail fires + hard-stop hits)
//   3. What to QUEUE tomorrow (open recs + Test A picks that didn't fill)
//   4. Catalysts within 24h (earnings, 8-Ks flagged as high-signal)
//
// Deliberately shorter than the morning briefing — the AI writes 200-400
// words, no web_search, uses the same STATIC_SYSTEM_PROMPT-style caching.
//
// Gated by STOCKS_BRIEFING_ENABLED=1 (server) AND per-user
// portfolio.noTouchMode (only surfaces value for no-touch traders — the
// person on the desk all day doesn't need this).

import cron from "node-cron";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import StocksPositionStopFire from "../models/StocksPositionStopFire.js";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";
import { emailBriefing, portfolioSummary } from "./stocksDailyBriefing.js";
import { monitorPositionStops, formatPositionStopBlock } from "../services/stocksPositionStopMonitor.js";
import { getRealtimeQuote } from "../services/stocksIntradayFmp.js";

const EOD_SLOT = "16:15"; // 4:15 PM ET

const EOD_SYSTEM_PROMPT = `You are Richard's personal stock advisor writing a SHORT END-OF-DAY RECAP.

TONE + SHAPE:
- Compact. 200-400 words max. Written for a trader who wasn't watching the tape.
- Start with the date + "EOD recap" heading. No preamble.
- End with "Research and education only. Not licensed investment advice."

REQUIRED SECTIONS (skip any whose block below is empty):
1. **## ✅ Filled today** — one line per BUY/SELL leg that executed today. Format:
     "**BOUGHT** N sh TICKER @ $X CCY in ACCOUNT — [linked rec date if any]"
     "**SOLD** N sh TICKER @ $X CCY in ACCOUNT — [target hit / stop hit / manual]"
   If nothing filled: skip the section.

2. **## 🛑 Stopped today** — one line per hard-stop / trail-stop fire. Format:
     "🚨 TICKER hit -N% hard stop at $X · exited [Y sh at $Z / STILL OPEN]"
   Emphasize any STILL-OPEN stop violation with an "EXIT TOMORROW MORNING AT MARKET" instruction.

3. **## 🕗 Queue tomorrow before 8:45 AM ET** — copy-paste-ready order list, same format as the morning briefing's queue block:
     "1. LIMIT BUY N sh TICKER @ $X CCY · GTC (Account) — [thesis one-liner]"
     "2. LIMIT SELL N sh TICKER @ $X CCY · GTC (Account) — [thesis one-liner]"
   Include: (a) any open BUY rec that hasn't been filled yet and is still near its entry zone, (b) any Test A pick from today that didn't fill and remains in-zone at close, (c) any trail-stop that needs a new GTC-STOP-LIMIT re-queue after today's fill.
   If nothing to queue: write ONE line — "No orders to queue tomorrow — hold current positions."

4. **## 📅 Catalysts within 24h** — one line per held ticker with an earnings date tomorrow or a fresh high-signal 8-K filed today.
   Skip if empty.

RULES:
- Prices in native currency. Never echo the total portfolio $ value.
- HELD tickers are pre-verified — never write "not found" for a held ticker.
- No <RECS> block — this is a recap, not a rec-generating pass.
- No prose padding between sections. Numbers > adjectives.`;

async function callAnthropicEod(userMessage) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.STOCKS_EOD_MODEL || process.env.STOCKS_ADVICE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1200,
      system: [{ type: "text", text: EOD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const e = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${e.slice(0, 200)}`);
  }
  const j = await resp.json();
  return (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// Trade legs executed today (ET-day boundary).
async function fillsToday(email) {
  const startEt = new Date();
  startEt.setUTCHours(startEt.getUTCHours() - 4); // rough ET
  startEt.setHours(0, 0, 0, 0);
  return await StocksTradeJournal.find({ email, executedAt: { $gte: startEt } })
    .populate("linkedAdviceRecId", "ticker action entryPrice targetPrice stopPrice generatedAt")
    .populate("linkedDailyPickId", "ticker entryPrice targetPrice stopPrice setupName")
    .sort({ executedAt: -1 })
    .lean();
}

// Position-stop fires today (any tier).
async function stopFiresToday(email) {
  const startEt = new Date();
  startEt.setUTCHours(startEt.getUTCHours() - 4);
  startEt.setHours(0, 0, 0, 0);
  return await StocksPositionStopFire.find({ email, firedAt: { $gte: startEt } })
    .sort({ firedAt: -1 })
    .lean();
}

// Open BUY recs from the last 30d that haven't been filled and whose
// entry zone might still be relevant tomorrow. We reuse the same near-
// zone heuristic as the intraday job (current price within ±5% of the
// rec's entry).
async function pendingBuyRecs(email) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recs = await StocksAdviceRec.find({
    email,
    action: "BUY",
    generatedAt: { $gte: cutoff },
    status: "open",
    exitLevelsFilledBy: { $exists: false },
    linkedBuyRecId: { $exists: false },
  }).sort({ generatedAt: -1 }).lean();
  return recs;
}

// Test A picks emitted today that are still open (didn't get filled today).
async function openTestAPicks(email) {
  const startEt = new Date();
  startEt.setUTCHours(startEt.getUTCHours() - 4);
  startEt.setHours(0, 0, 0, 0);
  return await StocksDailyPick.find({
    email,
    pickDate: { $gte: startEt },
    status: "open",
    enteredAt: { $exists: false },
  }).sort({ deterministicScore: -1 }).lean();
}

// Best-effort current price for each ticker in a set, via FMP realtime.
async function currentPriceMap(tickers, currencyMap = {}) {
  const uniq = [...new Set((tickers || []).map(t => String(t || "").toUpperCase()))].filter(Boolean);
  const results = await Promise.all(uniq.map(async (t) => {
    try {
      const q = await getRealtimeQuote(t, currencyMap[t] || "USD");
      return [t, q?.price ?? null];
    } catch { return [t, null]; }
  }));
  return new Map(results.filter(([, px]) => px != null));
}

function formatFillsBlock(fills) {
  if (!fills || fills.length === 0) return "No trades filled today.";
  const lines = [];
  for (const t of fills) {
    for (const leg of t.legs || []) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      const linkage = t.linkedAdviceRecId
        ? `AI rec ${new Date(t.linkedAdviceRecId.generatedAt).toISOString().slice(0, 10)}`
        : t.linkedDailyPickId
          ? `Test A pick ${t.linkedDailyPickId.setupName || "(no setup)"}`
          : "manual";
      lines.push(`  ${leg.side} ${leg.shares || "?"} sh ${leg.ticker} @ $${leg.pricePerShare?.toFixed(2)} ${leg.currency} in ${t.accountName || t.account} · ${linkage}`);
    }
  }
  if (!lines.length) return "No BUY/SELL legs filled today.";
  return `FILLED TODAY:\n${lines.join("\n")}`;
}

function formatStopsBlock(fires, positions, priceMap) {
  if (!fires || fires.length === 0) return "No hard-stop / trail-stop fires today.";
  const heldSet = new Set((positions || []).map(p => String(p.ticker || "").toUpperCase()));
  const lines = [];
  for (const f of fires) {
    const stillHeld = heldSet.has(String(f.ticker).toUpperCase());
    const cur = priceMap.get(String(f.ticker).toUpperCase());
    lines.push(`  ${f.ticker} · tier ${f.tier} · P/L at fire ${f.pnlPctAtFire?.toFixed(1)}% · account ${f.account || "(unspecified)"}${cur != null ? ` · current $${cur.toFixed(2)}` : ""}${stillHeld ? " · STILL HELD (needs exit)" : ""}`);
  }
  return `STOP FIRES TODAY:\n${lines.join("\n")}`;
}

function formatQueueBlock(recs, picks, priceMap, positions) {
  const parts = [];
  for (const r of (recs || [])) {
    const cur = priceMap.get(String(r.ticker).toUpperCase());
    if (cur == null) continue;
    // Only surface if current price is within ±5% of entry (still near-zone tomorrow)
    const near = Math.abs((cur - r.entryPrice) / r.entryPrice) <= 0.05;
    if (!near) continue;
    parts.push(`  BUY REC (still open): ${r.ticker} · entry $${r.entryPrice?.toFixed(2)} · target $${r.targetPrice?.toFixed(2)} · stop $${r.stopPrice?.toFixed(2)} · current $${cur.toFixed(2)} · currency ${r.entryCurrency || "USD"}`);
  }
  for (const p of (picks || [])) {
    const cur = priceMap.get(String(p.ticker).toUpperCase());
    if (cur == null) continue;
    const near = Math.abs((cur - p.entryPrice) / p.entryPrice) <= 0.05;
    if (!near) continue;
    parts.push(`  TEST A PICK (unfilled): ${p.ticker} · entry $${p.entryPrice?.toFixed(2)} · target $${p.targetPrice?.toFixed(2)} · stop $${p.stopPrice?.toFixed(2)} · setup ${p.setupName || "-"} · score ${p.deterministicScore || "-"} · current $${cur.toFixed(2)} · currency ${p.currency || "USD"}`);
  }
  if (parts.length === 0) return "No pending recs / picks near entry-zone for tomorrow's queue.";
  return `PENDING FOR TOMORROW'S QUEUE:\n${parts.join("\n")}`;
}

async function buildEodUserMessage(profile) {
  const [fills, fires, recs, picks] = await Promise.all([
    fillsToday(profile.email),
    stopFiresToday(profile.email),
    pendingBuyRecs(profile.email),
    openTestAPicks(profile.email),
  ]);
  // Fresh quotes for held tickers + candidate tickers so the queue block
  // knows current prices without going stale from morning snapshots.
  const currencyMap = {};
  for (const p of profile.positions || []) currencyMap[String(p.ticker || "").toUpperCase()] = p.ccy || "USD";
  const candidateTickers = [
    ...(profile.positions || []).map(p => String(p.ticker || "").toUpperCase()),
    ...recs.map(r => String(r.ticker || "").toUpperCase()),
    ...picks.map(p => String(p.ticker || "").toUpperCase()),
  ];
  const priceMap = await currentPriceMap(candidateTickers, currencyMap);

  const stops = monitorPositionStops(profile.positions || [], profile.accounts || []);
  const stopsBlock = formatPositionStopBlock(stops) || "No open P&L stop conditions on positions.";

  const hasAnything =
    (fills?.length || 0) > 0 ||
    (fires?.length || 0) > 0 ||
    (recs?.length || 0) > 0 ||
    (picks?.length || 0) > 0 ||
    (stops?.hardStopHit?.length || 0) > 0;

  const summary = portfolioSummary(profile);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const userMessage = `End-of-day recap for ${profile.email}. Today: ${today}.

Holdings (reference only — do NOT restate the full book):
${summary.table}

${formatFillsBlock(fills)}

${formatStopsBlock(fires, profile.positions, priceMap)}

${formatQueueBlock(recs, picks, priceMap, profile.positions)}

${stopsBlock}

Write the recap per the system prompt. Skip any section whose block above is empty. If NOTHING is present at all, output a single line: "Quiet day — no fills, no stops, no queue changes needed for tomorrow." and end.`;

  return { userMessage, hasAnything };
}

export async function runEodRecapForUser(profile, ymd) {
  const sendKey = ymd;
  if (profile.lastEodRecapSentKey === sendKey) return { skipped: "already-sent" };

  const { userMessage, hasAnything } = await buildEodUserMessage(profile);

  // Persist dedup key even if nothing to say.
  await StocksPortfolio.updateOne(
    { email: profile.email },
    { $set: { lastEodRecapSentKey: sendKey, lastEodRecapAt: new Date() } }
  );

  if (!hasAnything) {
    console.log(`[stocks-eod] ${profile.email} — quiet day, no email`);
    return { skipped: "quiet-day" };
  }

  const md = await callAnthropicEod(userMessage);
  if (!md) return { skipped: "empty-recap" };

  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const subject = `EOD recap — ${dateStr}`;
  await emailBriefing({ to: profile.email, subject, md });
  console.log(`[stocks-eod] ✓ ${profile.email} — ${md.length} chars sent`);
  return { sent: true };
}

function currentSlotEt(now) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === "hour")?.value?.padStart(2, "0") || "00";
  const mm = parts.find(p => p.type === "minute")?.value?.padStart(2, "0") || "00";
  const wd = parts.find(p => p.type === "weekday")?.value || "";
  const y = parts.find(p => p.type === "year")?.value || "";
  const m = parts.find(p => p.type === "month")?.value || "";
  const d = parts.find(p => p.type === "day")?.value || "";
  return { hhmm: `${hh}:${mm}`, ymd: `${y}-${m}-${d}`, weekday: wd };
}

async function findUsersDueForEod(now) {
  const { hhmm, ymd, weekday } = currentSlotEt(now);
  if (weekday === "Sat" || weekday === "Sun") return [];
  if (hhmm !== EOD_SLOT) return [];
  const portfolios = await StocksPortfolio.find({
    noTouchMode: true,
    "positions.0": { $exists: true },
  }).lean();
  const due = [];
  for (const p of portfolios) {
    if (p.lastEodRecapSentKey === ymd) continue;
    due.push({ portfolio: p, ymd });
  }
  return due;
}

export function scheduleEodRecap() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") {
    console.log("[stocks-eod] disabled (set STOCKS_BRIEFING_ENABLED=1 to turn on)");
    return null;
  }
  console.log(`[stocks-eod] scheduled: every minute, fires at ${EOD_SLOT} ET Mon-Fri for no-touch users`);
  return cron.schedule("* * * * *", async () => {
    try {
      const due = await findUsersDueForEod(new Date());
      try {
        await StocksSystemHeartbeat.findOneAndUpdate(
          { name: "eod-recap-tick" },
          { $set: { lastTickAt: new Date(), lastTickDueCount: due.length } },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch { /* heartbeat is best-effort */ }
      if (due.length === 0) return;
      console.log(`[stocks-eod] tick: ${due.length} user(s) due`);
      for (const { portfolio, ymd } of due) {
        try { await runEodRecapForUser(portfolio, ymd); }
        catch (e) { console.error(`[stocks-eod] ✗ ${portfolio.email}:`, e?.message); }
      }
    } catch (e) { console.error("[stocks-eod] tick error:", e); }
  });
}
