// backend/jobs/stocksSpecialSituationsPoll.js
//
// Daily 06:00 America/Toronto cron that refreshes the special-situation
// store from FMP + StocksEightK Item 1.01 and marks any stale deals
// EXPIRED. Idempotent — same call twice produces the same state.
//
// The pick engine's preflight gate READS from the store, so this cron's
// job is only to keep the store fresh. If it fails, the pick engine
// continues to see whatever the last successful sync wrote — which is
// safe (fail-closed on stale-but-known deals) rather than the wrong
// behavior of "no cron → no gate".
//
// Health: heartbeat under name "special-situations-poll". Diagnostics
// distinguishes "cron hasn't fired" from "cron fired but scanned 0".

import cron from "node-cron";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";

// Runs the sync + stamps heartbeat. Called by the cron and by the
// diagnostics "run now" hook (if any) — always safe to invoke
// standalone.
export async function runSpecialSituationsPoll(opts = {}) {
  const heartbeatName = "special-situations-poll";
  const startedAt = Date.now();
  try {
    const { syncSpecialSituationsForUniverse } = await import("../services/stocksSpecialSituations.js");
    // Feed in the current pick-engine universe when available so 8-K
    // signals are scoped to tickers we actually care about. Falls back
    // to null (broad scan) when the universe helper isn't loaded yet.
    let universe = null;
    try {
      const { resolveEligibleUniverse } = await import("../services/stocksDiscoveryService.js").catch(() => ({}));
      if (typeof resolveEligibleUniverse === "function") {
        universe = await resolveEligibleUniverse().catch(() => null);
      }
    } catch { /* ignore */ }
    const summary = await syncSpecialSituationsForUniverse({
      tickers: Array.isArray(universe) ? universe : null,
      ...opts,
    });
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: heartbeatName },
      { $set: { lastTickAt: new Date(), lastRunSummary: summary, lastError: null, lastErrorAt: null } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    return summary;
  } catch (e) {
    const errMsg = String(e?.message || e).slice(0, 500);
    console.error("[special-situations-poll] fatal:", e);
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: heartbeatName },
      { $set: { lastTickAt: new Date(), lastError: errMsg, lastErrorAt: new Date(),
                lastRunSummary: { failed: true, elapsedMs: Date.now() - startedAt } } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    return { error: errMsg };
  }
}

export function scheduleSpecialSituationsPoll() {
  if (process.env.STOCKS_SPECIAL_SITUATIONS_POLL_ENABLED === "0") {
    console.log("[special-situations-poll] disabled (STOCKS_SPECIAL_SITUATIONS_POLL_ENABLED=0)");
    return null;
  }
  const expr = process.env.STOCKS_SPECIAL_SITUATIONS_CRON || "0 6 * * *"; // 06:00 America/Toronto
  console.log(`[special-situations-poll] scheduled: ${expr} America/Toronto`);
  return cron.schedule(expr, async () => {
    console.log("[special-situations-poll] tick");
    try { await runSpecialSituationsPoll({ verbose: true }); }
    catch (e) { console.error("[special-situations-poll] tick error:", e); }
  }, { timezone: "America/Toronto" });
}
