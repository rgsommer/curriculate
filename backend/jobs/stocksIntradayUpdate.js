// backend/jobs/stocksIntradayUpdate.js
//
// Intraday market-update briefings. Fires at 11:00 / 13:00 / 15:00 ET
// on trading days (weekdays) and produces a short, tape-focused update
// for users who opted in via portfolio.intradayUpdatesEnabled.
//
// The update is action-oriented and short by design. It emails ONLY
// when at least one action-worthy signal is present:
//   • Position P&L stop crossed since the morning briefing (-8% / -6% / -5%)
//   • Fresh SEC 8-K since 09:30 ET for a held ticker
//   • Fed liquidity regime flipped (risk-on ↔ neutral ↔ risk-off)
//   • Any of today's Test A daily picks has entered its entry zone
//   • Any open BUY rec has just crossed into its entry zone
// On a quiet tape, this job runs and skips silently — zero email spam.
//
// Cost profile: reuses the STATIC_SYSTEM_PROMPT via cache_control on
// intraday-tuned wrapper (shorter, tape-focused) so per-call token cost
// is a fraction of the morning briefing.
//
// Gated by STOCKS_INTRADAY_UPDATES_ENABLED=1 (server env) AND per-user
// portfolio.intradayUpdatesEnabled (default false).

import cron from "node-cron";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksEightK from "../models/StocksEightK.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";
import {
  portfolioSummary,
  emailBriefing,
  monitorOpenRecs,
} from "./stocksDailyBriefing.js";
import {
  monitorPositionStops,
  formatPositionStopBlock,
} from "../services/stocksPositionStopMonitor.js";
import { getFedLiquidity, formatFedLiquidityBlock } from "../services/stocksFedLiquidity.js";
import { getSectorRotation, formatSectorRotationBlock } from "../services/stocksSectorRotation.js";
import { getRealtimeQuote } from "../services/stocksIntradayFmp.js";

// Intraday slots (24h HH:MM) in America/New_York. Weekdays only. The
// per-minute tick checks against these three.
const INTRADAY_SLOTS = ["11:00", "13:00", "15:00"];

const INTRADAY_SYSTEM_PROMPT = `You are Richard's personal stock advisor writing a MID-DAY MARKET UPDATE — a short (150-350 word) intraday briefing sent between the morning briefing (7:30 AM ET) and the close (4:00 PM ET).

TONE + SHAPE:
- Short. Tight. Action-first. No preamble, no "here's what I found." Start with the date + slot label.
- Only cover what changed since morning. Do NOT re-narrate the portfolio or restate this morning's setups.
- If nothing meaningful has moved, say so in one line and end. Users appreciate silence more than filler.
- End with "Research and education only. Not licensed investment advice."

WHAT COUNTS AS INTRADAY-ACTIONABLE:
1. Position P&L stop crossings — hard-stop (≤-8%) requires EXIT AT MARKET call; within-stop (-8% to -6%) requires TIGHTEN call; watch (-6% to -5%) is a heads-up.
2. Fresh SEC 8-K on a held ticker (filed since 09:30 ET today) — quote the item numbers and say whether it's high-signal (item 1.01 merger, 5.02 exec change, 8.01 material event) or noise (2.02 earnings scheduling, 9.01 exhibit filing).
3. Fed liquidity regime flip vs morning — this is a rare but load-bearing shift. Say what changed and what to do.
4. Today's Test A daily picks that have ENTERED their entry zone since morning — flag for consideration, quote entry/target/stop verbatim from the briefing.
5. Open BUY recs (from morning or earlier) that have entered their entry zone since morning — same treatment as Test A entries.

OUTPUT FORMAT:
- Start with a compact H1: "# 📈 Midday update — HH:MM ET · YYYY-MM-DD".
- One short section per active signal (skip anything not in the block below).
- If the block below is empty, output ONE line: "No action-worthy changes since morning. Tape quiet." and end.
- Do NOT include the trailing <RECS> block — this is a status update, not a rec-generating briefing.
- Prices in security's native currency; NEVER echo the total portfolio value.
- HELD tickers ARE pre-verified — never write "Ticker Not Found" for a held ticker.`;

// Format the intraday context block. Returns { userMessage, hasActionable }.
function buildIntradayUserMessage({ profile, slot, ymd, stops, freshEightKs, regimeFlip, picksEnteringZone, recsEnteringZone }) {
  const hasActionable =
    (stops?.hardStopHit?.length || 0) > 0 ||
    (stops?.withinStop?.length || 0) > 0 ||
    (stops?.watch?.length || 0) > 0 ||
    (freshEightKs?.length || 0) > 0 ||
    !!regimeFlip ||
    (picksEnteringZone?.length || 0) > 0 ||
    (recsEnteringZone?.length || 0) > 0;

  const stopsBlock = formatPositionStopBlock(stops) || "No position P&L stops crossed.";

  const eightKBlock = (freshEightKs || []).length === 0
    ? "No fresh 8-Ks on held tickers since morning."
    : `FRESH 8-K FILINGS (since 09:30 ET today, held tickers only):\n${freshEightKs.map(f =>
        `  - ${f.ticker} · items [${(f.itemNumbers || []).join(", ")}] · ${(f.itemLabels || []).slice(0, 2).join(" / ")}${f.highSignal ? " 🔥 high-signal" : ""} · filed ${new Date(f.filedAt).toISOString().slice(0, 16).replace("T", " ")} UTC${f.url ? `\n    ${f.url}` : ""}`
      ).join("\n")}`;

  const regimeBlock = !regimeFlip
    ? "Fed liquidity regime unchanged since morning."
    : `⚡ REGIME FLIP: ${regimeFlip.was} → ${regimeFlip.now} (score ${regimeFlip.nowScore}). Top contributor: ${regimeFlip.topContributor || "n/a"}. This overrules individual-position calls — trim size in risk-off, take breakouts in risk-on.`;

  const picksBlock = (picksEnteringZone || []).length === 0
    ? "No Test A daily picks entered their entry zone since morning."
    : `TEST A DAILY PICKS THAT ENTERED ENTRY ZONE:\n${picksEnteringZone.map(p =>
        `  - ${p.ticker} · current $${p.currentPrice?.toFixed(2)} ${p.currency || "USD"} (entry $${p.entryPrice?.toFixed(2)}, target $${p.targetPrice?.toFixed(2)}, stop $${p.stopPrice?.toFixed(2)}) · setup: ${p.setupName || "-"} · score ${p.deterministicScore || "-"} · 10d horizon`
      ).join("\n")}`;

  const recsBlock = (recsEnteringZone || []).length === 0
    ? "No open BUY recs entered their entry zone since morning."
    : `OPEN BUY RECS THAT ENTERED ENTRY ZONE:\n${recsEnteringZone.map(r =>
        `  - ${r.ticker} · current $${r.currentPrice?.toFixed(2)} ${r.currency || "USD"} (entry $${r.entryPrice?.toFixed(2)}, target $${r.targetPrice?.toFixed(2)}, stop $${r.stopPrice?.toFixed(2)}) · from morning briefing ${new Date(r.generatedAt).toISOString().slice(0, 10)}`
      ).join("\n")}`;

  const summary = portfolioSummary(profile);
  const userMessage = `Intraday update slot: ${slot} ET on ${ymd}.

Holdings (for reference — do NOT restate the whole book, only tickers that show up in the blocks below):
${summary.table}

${stopsBlock}

${eightKBlock}

${regimeBlock}

${picksBlock}

${recsBlock}

Write the update per the system prompt. If none of the five blocks above have any content, output the "Tape quiet." line and end.`;

  return { userMessage, hasActionable };
}

// Call Anthropic with the intraday system prompt (cached separately from
// the morning-briefing prompt) and no tools — the intraday call doesn't
// need web_search; all inputs are already in the user message.
async function callAnthropicIntraday(userMessage) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.STOCKS_INTRADAY_MODEL || process.env.STOCKS_ADVICE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1024,
      system: [{ type: "text", text: INTRADAY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const e = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${e.slice(0, 200)}`);
  }
  const j = await resp.json();
  const u = j?.usage || {};
  if (u.cache_creation_input_tokens || u.cache_read_input_tokens) {
    console.log(`[stocks-intraday] cache: created=${u.cache_creation_input_tokens || 0} read=${u.cache_read_input_tokens || 0} input=${u.input_tokens || 0}`);
  }
  return (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// Compute which of today's daily picks JUST entered their entry zone
// (current price ≤ upper bound of a 2% pullback from entryPrice, and
// ≥ 5% away from stop). We treat "entry zone" as [entry * 0.985, entry * 1.015]
// which is a tight window that only fires when the tape actually
// pulls into the pick's stated entry.
async function findPicksEnteringZone(email, quoteMap) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const picks = await StocksDailyPick.find({
    email,
    pickDate: { $gte: startOfDay },
    enteredAt: { $exists: false }, // exclude picks already recorded as entered
  }).lean();
  const out = [];
  for (const p of picks || []) {
    const q = quoteMap.get(String(p.ticker || "").toUpperCase());
    if (!q?.price) continue;
    const cur = q.price;
    const lo = p.entryPrice * 0.985;
    const hi = p.entryPrice * 1.015;
    if (cur >= lo && cur <= hi) {
      out.push({ ...p, currentPrice: cur });
    }
  }
  return out;
}

// Same idea for open BUY recs — check any not-yet-filled BUY where
// current price entered the [entry * 0.985, entry * 1.015] band.
async function findRecsEnteringZone(email, quoteMap) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recs = await StocksAdviceRec.find({
    email,
    action: "BUY",
    generatedAt: { $gte: cutoff },
    exitLevelsFilledBy: { $exists: false },
    linkedBuyRecId: { $exists: false },
  }).lean();
  const out = [];
  for (const r of recs || []) {
    if (!r.entryPrice) continue;
    const q = quoteMap.get(String(r.ticker || "").toUpperCase());
    if (!q?.price) continue;
    const cur = q.price;
    const lo = r.entryPrice * 0.985;
    const hi = r.entryPrice * 1.015;
    if (cur >= lo && cur <= hi) {
      out.push({ ...r, currentPrice: cur });
    }
  }
  return out;
}

// Fetch fresh quotes for every held ticker, in parallel with a cap so
// we don't hammer FMP. Returns a Map of TICKER → quote.
async function fetchQuoteMap(positions) {
  const tickers = [...new Set((positions || []).map(p => String(p.ticker || "").toUpperCase()))].filter(Boolean);
  const currencies = {};
  for (const p of positions || []) currencies[String(p.ticker || "").toUpperCase()] = p.ccy || "USD";
  const results = await Promise.all(tickers.map(async (t) => {
    try {
      const q = await getRealtimeQuote(t, currencies[t] || "USD");
      return [t, q];
    } catch { return [t, null]; }
  }));
  const map = new Map();
  for (const [t, q] of results) if (q) map.set(t, q);
  return map;
}

// Apply the intraday quotes to a lean profile so monitorPositionStops sees
// live prices, not stale ones from the last portfolio-snapshot run.
function overlayIntradayPrices(profile, quoteMap) {
  const positions = (profile.positions || []).map(p => {
    const q = quoteMap.get(String(p.ticker || "").toUpperCase());
    if (!q?.price) return p;
    if (p.ccy === "USD") return { ...p, priceUsd: q.price };
    return { ...p, priceCad: q.price };
  });
  return { ...profile, positions };
}

// Fetch fresh 8-Ks for held tickers since 09:30 ET today.
async function findFreshEightKs(positions) {
  const tickers = [...new Set((positions || []).map(p =>
    String(p.ticker || "").toUpperCase().replace(/\..*$/, "")
  ))].filter(Boolean);
  if (!tickers.length) return [];
  // 09:30 ET today in UTC = 13:30 UTC (EDT) or 14:30 UTC (EST). We use
  // a slightly earlier fudge (09:00 ET) so DST edges don't cause a miss.
  const morningEt = new Date();
  morningEt.setUTCHours(morningEt.getUTCHours() - 4);  // rough ET
  morningEt.setHours(9, 0, 0, 0);
  return await StocksEightK.find({
    ticker: { $in: tickers },
    filedAt: { $gte: morningEt },
  }).sort({ filedAt: -1 }).limit(20).lean();
}

// Compare the current Fed-liquidity regime to whatever the morning
// briefing was aware of. We stamp the last-observed regime on the
// portfolio's lastIntradayUpdateAt/regime metadata (we approximate by
// pulling the current regime and returning a flip descriptor iff
// meaningfully different).
async function detectRegimeFlip(prevRegime) {
  const fed = await getFedLiquidity().catch(() => null);
  if (!fed?.regime) return { fed, flip: null };
  if (!prevRegime || prevRegime === fed.regime) return { fed, flip: null };
  return {
    fed,
    flip: {
      was: prevRegime,
      now: fed.regime,
      nowScore: fed.score,
      topContributor: (fed.contributors || [])[0] || null,
    },
  };
}

// Format the day/timezone-aware key so the tick idempotency key matches
// the morning briefing's format.
function currentSlotEt(now) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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

export async function runIntradayUpdateForUser(profile, slot, ymd) {
  const sendKey = `${ymd}|${slot}`;
  // Dedup — never fire twice for the same slot on the same day.
  if (profile.lastIntradayUpdateSentKey === sendKey) return { skipped: "already-sent" };

  // Fetch live quotes so position stops + zone checks use fresh prices.
  const quoteMap = await fetchQuoteMap(profile.positions);
  const liveProfile = overlayIntradayPrices(profile, quoteMap);

  const stops = monitorPositionStops(liveProfile.positions || []);
  const freshEightKs = await findFreshEightKs(liveProfile.positions);

  // Regime flip — compare to what the last morning briefing / previous
  // intraday captured. We stamp regime on the doc after each fire.
  const prevRegime = profile.lastIntradayRegime || null;
  const { fed, flip } = await detectRegimeFlip(prevRegime);

  const picksEnteringZone = await findPicksEnteringZone(profile.email, quoteMap);
  const recsEnteringZone = await findRecsEnteringZone(profile.email, quoteMap);

  const { userMessage, hasActionable } = buildIntradayUserMessage({
    profile: liveProfile,
    slot,
    ymd,
    stops,
    freshEightKs,
    regimeFlip: flip,
    picksEnteringZone,
    recsEnteringZone,
  });

  // Persist dedup + regime state even if we skip email.
  await StocksPortfolio.updateOne(
    { email: profile.email },
    {
      $set: {
        lastIntradayUpdateSentKey: sendKey,
        lastIntradayUpdateAt: new Date(),
        ...(fed?.regime ? { lastIntradayRegime: fed.regime } : {}),
      },
    }
  );

  if (!hasActionable) {
    console.log(`[stocks-intraday] ${profile.email} @ ${slot} — quiet tape, no email`);
    return { skipped: "no-actionable-signals" };
  }

  // Anthropic call.
  const md = await callAnthropicIntraday(userMessage);
  if (!md) return { skipped: "empty-briefing" };

  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const subject = `Midday update ${slot} ET — ${dateStr}`;
  await emailBriefing({ to: profile.email, subject, md });
  console.log(`[stocks-intraday] ✓ ${profile.email} @ ${slot} — ${md.length} chars sent`);
  return { sent: true };
}

async function findUsersDueForIntraday(now) {
  const { hhmm, weekday } = currentSlotEt(now);
  // Skip weekends (Sat/Sun in ET) — markets are closed.
  if (weekday === "Sat" || weekday === "Sun") return [];
  if (!INTRADAY_SLOTS.includes(hhmm)) return [];
  const { ymd } = currentSlotEt(now);
  const portfolios = await StocksPortfolio.find({
    intradayUpdatesEnabled: true,
    "positions.0": { $exists: true },
  }).lean();
  const due = [];
  for (const p of portfolios) {
    const sendKey = `${ymd}|${hhmm}`;
    if (p.lastIntradayUpdateSentKey === sendKey) continue;
    due.push({ portfolio: p, slot: hhmm, ymd });
  }
  return due;
}

export function scheduleIntradayUpdates() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") return null;
  if (process.env.STOCKS_INTRADAY_UPDATES_ENABLED !== "1") {
    console.log("[stocks-intraday] disabled (set STOCKS_INTRADAY_UPDATES_ENABLED=1 to turn on)");
    return null;
  }
  console.log(`[stocks-intraday] scheduled: every minute, fires at ${INTRADAY_SLOTS.join(" / ")} ET on weekdays`);
  return cron.schedule("* * * * *", async () => {
    try {
      const due = await findUsersDueForIntraday(new Date());
      try {
        await StocksSystemHeartbeat.findOneAndUpdate(
          { name: "intraday-update-tick" },
          { $set: { lastTickAt: new Date(), lastTickDueCount: due.length } },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch (e) { console.warn("[stocks-intraday] heartbeat write failed:", e?.message); }
      if (due.length === 0) return;
      console.log(`[stocks-intraday] tick: ${due.length} user(s) due`);
      for (const { portfolio, slot, ymd } of due) {
        try {
          await runIntradayUpdateForUser(portfolio, slot, ymd);
        } catch (e) {
          console.error(`[stocks-intraday] ✗ ${portfolio.email}:`, e?.message);
        }
      }
    } catch (e) { console.error("[stocks-intraday] tick error:", e); }
  });
}
