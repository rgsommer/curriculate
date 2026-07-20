// backend/jobs/stocksDailyPick.js
//
// Weekday-morning cron that FORCES 1-2 picks per user per day and writes
// them to StocksDailyPick — the honest paper-portfolio record. Also runs
// a second daily sweep to mark-to-market and close picks that hit target,
// stop, or horizon.
//
// The point: no cherry-picking. Every pick is tracked to close. Losers
// count toward win rate. This is the ex-ante integrity check the AI
// output alone can't provide.

import cron from "node-cron";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import { generateDailyPicksForUser } from "../services/stocksDailyPickEngine.js";
import { getTechnicals } from "../services/stocksTechnicals.js";

const TZ = "America/New_York";

// Only fire on trading days (Mon-Fri, ET). Holidays aren't excluded —
// the cost is a duplicate pick attempt on a market-closed day, which
// resolves cleanly (no fresh price, no fill, no state change).
function isTradingDayET() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).formatToParts(new Date());
  const dow = parts.find((p) => p.type === "weekday")?.value;
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(dow);
}

function ymdET(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Generate picks for one user and persist. Idempotent per (email, pickDate).
export async function generateAndPersistPicksForUser(profile, { n = 2 } = {}) {
  const today = ymdET(new Date());
  const existing = await StocksDailyPick.find({ email: profile.email, pickDate: { $gte: new Date(`${today}T00:00:00-05:00`), $lt: new Date(`${today}T23:59:59-05:00`) } }).lean();
  if (existing.length >= n) return { skipped: true, existing: existing.length };

  const picks = await generateDailyPicksForUser({ email: profile.email, n: n - existing.length });
  const now = new Date();
  const inserted = [];
  for (const p of picks) {
    try {
      const doc = await StocksDailyPick.create({
        email: profile.email,
        pickDate: now,
        ticker: p.ticker,
        currency: p.currency || "USD",
        entryPrice: p.entryPrice,
        targetPrice: p.targetPrice,
        stopPrice: p.stopPrice,
        horizonDays: 10,
        deterministicScore: p.deterministicScore,
        scoreContributors: p.scoreContributors,
        setupName: p.setupName,
        mtfConfluence: p.mtfConfluence,
        rationale: p.rationale,
      });
      inserted.push(doc.toObject());
    } catch (e) { console.warn(`[daily-pick] persist ${p.ticker} failed: ${e?.message}`); }
  }
  return { inserted };
}

// Mark-to-market + close any open picks that hit target, stop, or horizon.
export async function sweepOpenPicks() {
  const opens = await StocksDailyPick.find({ status: "open" }).lean();
  const now = new Date();
  let closed = 0;
  for (const p of opens) {
    try {
      const tech = await getTechnicals(p.ticker, p.currency);
      if (!tech?.ok || tech.last == null) continue;
      const price = tech.last;
      let update = { lastCheckedAt: now, lastCheckedPrice: price };
      const daysSincePick = Math.floor((now - new Date(p.pickDate)) / (24 * 60 * 60 * 1000));

      if (p.targetPrice != null && price >= p.targetPrice) {
        update = { ...update, status: "target-hit", exitPrice: price, exitDate: now, pnlPct: ((price - p.entryPrice) / p.entryPrice) * 100 };
      } else if (p.stopPrice != null && price <= p.stopPrice) {
        update = { ...update, status: "stop-hit", exitPrice: price, exitDate: now, pnlPct: ((price - p.entryPrice) / p.entryPrice) * 100 };
      } else if (daysSincePick >= (p.horizonDays || 10)) {
        update = { ...update, status: "horizon-exit", exitPrice: price, exitDate: now, pnlPct: ((price - p.entryPrice) / p.entryPrice) * 100 };
      }

      await StocksDailyPick.updateOne({ _id: p._id }, { $set: update });
      if (update.status && update.status !== "open") closed++;
    } catch (e) { console.warn(`[daily-pick sweep] ${p.ticker} failed: ${e?.message}`); }
  }
  return { checked: opens.length, closed };
}

export async function runDailyPickGenerationOnce() {
  if (!isTradingDayET()) return { skipped: "weekend/holiday" };
  const profiles = await StocksPortfolio.find({ "positions.0": { $exists: true } }).select({ email: 1 }).lean();
  let totalInserted = 0;
  for (const p of profiles) {
    try {
      const r = await generateAndPersistPicksForUser(p, { n: 2 });
      if (r.inserted?.length) totalInserted += r.inserted.length;
    } catch (e) { console.warn(`[daily-pick] ${p.email} failed: ${e?.message}`); }
  }
  return { users: profiles.length, totalInserted };
}

export function scheduleDailyPickCron() {
  if (process.env.STOCKS_DAILY_PICK_ENABLED !== "1") {
    console.log("[daily-pick] disabled (set STOCKS_DAILY_PICK_ENABLED=1 to turn on)");
    return null;
  }
  // Pick generation at 09:15 ET (before market open) so entryPrice is the
  // most recent close, and the pick is fully committed before intraday
  // moves. Sweep every hour during market hours.
  console.log("[daily-pick] scheduled: generation 09:15 ET · sweep hourly market hours");
  const generation = cron.schedule("15 9 * * 1-5", async () => {
    try {
      const stats = await runDailyPickGenerationOnce();
      console.log(`[daily-pick] generation:`, stats);
    } catch (e) { console.error("[daily-pick] generation error:", e?.message); }
  }, { timezone: TZ });
  const sweep = cron.schedule("30 * * * *", async () => {
    try {
      const stats = await sweepOpenPicks();
      if (stats.closed > 0) console.log(`[daily-pick] sweep: ${stats.checked} checked · ${stats.closed} closed`);
    } catch (e) { console.error("[daily-pick] sweep error:", e?.message); }
  }, { timezone: TZ });
  return { generation, sweep };
}
