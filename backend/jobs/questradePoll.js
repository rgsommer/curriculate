// backend/jobs/questradePoll.js
//
// Every 5 min tick: for each enabled Questrade integration, fetch
// recent activities and reconcile any new fills into the trade
// journal. Mirrors scheduleEmailPoller (CIBC) so both integrations
// can coexist during the transition period.
//
// Env vars:
//   QUESTRADE_POLL_ENABLED   — "1" to enable (default off)
//   QUESTRADE_POLL_CRON      — cron expression (default "*/5 * * * *")

import cron from "node-cron";
import QuestradeIntegration from "../models/QuestradeIntegration.js";
import { pollQuestradeMailboxLike } from "../services/questradeActivityPoller.js";

export async function runQuestradePollOnce() {
  const integrations = await QuestradeIntegration.find({ enabled: true, needsReconnect: { $ne: true } })
    .select({ email: 1 }).lean();
  const results = [];
  for (const i of integrations) {
    try {
      const r = await pollQuestradeMailboxLike(i.email);
      if (r.inserted > 0 || r.errors > 0) {
        console.log(`[questrade-poll] ${i.email}: inserted=${r.inserted} skipped=${r.skipped} errors=${r.errors}`);
      }
      results.push({ email: i.email, ...r });
    } catch (e) {
      console.warn(`[questrade-poll] ${i.email} failed:`, e?.message);
      results.push({ email: i.email, fatal: e?.message });
    }
  }
  return { checked: integrations.length, results };
}

export function scheduleQuestradePoll() {
  if (process.env.QUESTRADE_POLL_ENABLED !== "1") {
    console.log("[questrade-poll] disabled (set QUESTRADE_POLL_ENABLED=1 to turn on)");
    return null;
  }
  const expr = process.env.QUESTRADE_POLL_CRON || "*/5 * * * *";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[questrade-poll] scheduled: "${expr}" ${tz}`);
  return cron.schedule(expr, async () => {
    try { await runQuestradePollOnce(); }
    catch (e) { console.error("[questrade-poll] tick error:", e); }
  }, { timezone: tz });
}
