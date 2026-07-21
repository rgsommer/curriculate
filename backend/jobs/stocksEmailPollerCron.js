// backend/jobs/stocksEmailPollerCron.js
//
// Every 15 minutes, iterate over enabled StocksEmailIntegration rows
// and run the poller. Deliberately serialized (one user at a time)
// because IMAP is slow and users share cron capacity — parallelism
// buys little and can trip Gmail's per-IP throttling.
//
// Gated by STOCKS_BRIEFING_ENABLED=1 (same master switch as the
// briefing crons — a single deploy env var kills every scheduled
// stocks job at once).

import cron from "node-cron";
import StocksEmailIntegration from "../models/StocksEmailIntegration.js";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";
import { pollUserMailbox } from "../services/stocksEmailPoller.js";

export function scheduleEmailPoller() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") {
    console.log("[stocks-email-poller] disabled (set STOCKS_BRIEFING_ENABLED=1 to turn on)");
    return null;
  }
  const expr = process.env.STOCKS_EMAIL_POLLER_CRON || "*/15 * * * *";
  console.log(`[stocks-email-poller] scheduled: "${expr}" — polls enabled integrations end-to-end`);
  return cron.schedule(expr, async () => {
    try {
      const configured = await StocksEmailIntegration.find({ enabled: true }).lean();
      try {
        await StocksSystemHeartbeat.findOneAndUpdate(
          { name: "email-poller-tick" },
          { $set: { lastTickAt: new Date(), lastTickDueCount: configured.length } },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch { /* heartbeat is best-effort */ }
      if (configured.length === 0) return;
      console.log(`[stocks-email-poller] tick: ${configured.length} user(s) configured`);
      for (const integ of configured) {
        try {
          const res = await pollUserMailbox(integ.email);
          if (res.inserted) console.log(`[stocks-email-poller] ✓ ${integ.email} — ${res.inserted} inserted, ${res.skipped} skipped, ${res.errors} errors`);
        } catch (e) {
          console.error(`[stocks-email-poller] ✗ ${integ.email}:`, e?.message);
        }
      }
    } catch (e) { console.error("[stocks-email-poller] tick error:", e); }
  });
}
