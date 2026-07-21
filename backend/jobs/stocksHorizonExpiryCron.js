// backend/jobs/stocksHorizonExpiryCron.js
//
// Fires at 18:00 ET on weekdays. For each user, finds every open BUY
// rec whose horizonDays window has elapsed WITHOUT target or stop
// having triggered, and emails a "horizon expired" review — one row
// per stuck rec with the three explicit options: EXIT, ROLL, TRIM.
//
// After emailing, the rec's status is marked "horizon-expired" so the
// alert doesn't fire twice for the same rec (which would happen daily
// otherwise because horizonDays is a threshold, not an event).

import cron from "node-cron";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";
import { computeHorizonReview } from "../services/stocksHorizonReview.js";
import { emailBriefing } from "./stocksDailyBriefing.js";

async function sendHorizonExpiryEmail(email, expiredRows) {
  if (!process.env.RESEND_API_KEY) return { skipped: "no-resend-key" };
  if (!expiredRows.length) return { skipped: "nothing-expired" };

  const rowsMd = expiredRows.map((r) => {
    const cur = r.current != null ? `$${r.current.toFixed(2)}` : "n/a";
    const tgt = r.target != null ? `$${r.target.toFixed(2)}` : "n/a";
    const stp = r.stop != null ? `$${r.stop.toFixed(2)}` : "n/a";
    const pnl = (r.entry && r.current)
      ? (((r.current - r.entry) / r.entry) * 100).toFixed(1)
      : "n/a";
    return `
### ⌛ ${r.ticker} (${r.horizonDays}d rec expired)

- Entered:  day 1 at $${r.entry?.toFixed?.(2)}
- Today:    day ${r.daysElapsed} at ${cur} (${pnl}%)
- Target:   ${tgt} — never touched
- Stop:     ${stp} — never touched

The rec's stated hypothesis has run its course without confirmation.

**Options — pick one, don't default:**

1. **EXIT** — sell at market today, book the ${pnl}% result, redeploy cash. This is the disciplined default when nothing about the thesis has changed.
2. **ROLL** — extend the horizon by another 10 days ONLY IF you can name a specific reason (fresh earnings beat, upgraded analyst PT, new catalyst on the calendar, chart pattern that's still valid). "I like the name" is not a reason — that's how positions turn into 6-month bags.
3. **TRIM** — sell half now, keep the other half with the current stop. A hedged bet on the remaining thesis; caps regret in both directions.

Doing nothing = passive ROLL. The app treats it as such and stops alerting on this rec until it hits target/stop or you close it manually. That's fine as a choice; it's a problem as a default.
`;
  }).join("\n---\n");

  const md = `# ⌛ Horizon review — ${expiredRows.length} rec${expiredRows.length === 1 ? "" : "s"} at time-decision

The following BUY recs have hit their stated horizonDays without target or stop firing. They need an explicit decision (EXIT, ROLL, or TRIM) today.

${rowsMd}

---

Research and education only. Not licensed investment advice.
`;
  return await emailBriefing({
    to: email,
    subject: `⌛ ${expiredRows.length} horizon-expired rec${expiredRows.length === 1 ? "" : "s"} — EXIT, ROLL, or TRIM`,
    md,
  });
}

export async function runHorizonExpiryOnce({ onlyEmail = null } = {}) {
  const query = onlyEmail ? { email: onlyEmail } : {};
  const portfolios = await StocksPortfolio.find({
    ...query,
    "positions.0": { $exists: true },
  }).lean();

  for (const p of portfolios) {
    try {
      const rows = await computeHorizonReview(p.email);
      const expired = rows.filter((r) => r.status === "expired");
      if (expired.length === 0) continue;
      const result = await sendHorizonExpiryEmail(p.email, expired);
      if (result?.skipped) {
        console.log(`[stocks-horizon-expiry] ${p.email} — skipped: ${result.skipped}`);
        continue;
      }
      // Mark those recs as horizon-expired so we don't email again.
      await StocksAdviceRec.updateMany(
        { _id: { $in: expired.map((r) => r.recId) }, status: "open" },
        { $set: { status: "expired", hitAt: new Date() } }
      );
      console.log(`[stocks-horizon-expiry] ✓ ${p.email} — ${expired.length} rec(s) marked expired`);
    } catch (e) {
      console.error(`[stocks-horizon-expiry] ✗ ${p.email}:`, e?.message);
    }
  }
}

export function scheduleHorizonExpiry() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") {
    console.log("[stocks-horizon-expiry] disabled (STOCKS_BRIEFING_ENABLED != 1)");
    return null;
  }
  const expr = process.env.STOCKS_HORIZON_EXPIRY_CRON || "0 18 * * 1-5";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[stocks-horizon-expiry] scheduled: "${expr}" ${tz}`);
  return cron.schedule(expr, async () => {
    try {
      await StocksSystemHeartbeat.findOneAndUpdate(
        { name: "horizon-expiry-tick" },
        { $set: { lastTickAt: new Date() } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      await runHorizonExpiryOnce();
    } catch (e) { console.error("[stocks-horizon-expiry] tick error:", e); }
  }, { timezone: tz });
}
