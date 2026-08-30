// backend/jobs/stocksCoverageKpiCron.js
//
// Daily 05:30 America/Toronto cron that computes the missed-winner
// coverage KPI (Tier 2.3 audit Aug-28) and persists a snapshot to
// StocksMissedWinnerCoverage. Runs after the external-nominations
// sync (05:00) and before the daily briefings (07:30+) so the KPI is
// current when operators open their email.
//
// Health: heartbeat under name "coverage-kpi-cron". Disable via
// STOCKS_COVERAGE_KPI_ENABLED=0. Schedule override via
// STOCKS_COVERAGE_KPI_CRON.

import cron from "node-cron";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";

export async function runCoverageKpiSnapshot(opts = {}) {
  const heartbeatName = "coverage-kpi-cron";
  const startedAt = Date.now();
  try {
    const { computeMissedWinnerCoverage } = await import("../services/stocksMissedWinnerCoverage.js");
    const summary = await computeMissedWinnerCoverage(opts);
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: heartbeatName },
      { $set: { lastTickAt: new Date(), lastRunSummary: { ...summary, samples: undefined }, lastError: null, lastErrorAt: null } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    return summary;
  } catch (e) {
    const errMsg = String(e?.message || e).slice(0, 500);
    console.error("[coverage-kpi-cron] fatal:", e);
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: heartbeatName },
      { $set: { lastTickAt: new Date(), lastError: errMsg, lastErrorAt: new Date(),
                lastRunSummary: { failed: true, elapsedMs: Date.now() - startedAt } } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    return { error: errMsg };
  }
}

export function scheduleCoverageKpiCron() {
  if (process.env.STOCKS_COVERAGE_KPI_ENABLED === "0") {
    console.log("[coverage-kpi-cron] disabled (STOCKS_COVERAGE_KPI_ENABLED=0)");
    return null;
  }
  const expr = process.env.STOCKS_COVERAGE_KPI_CRON || "30 5 * * *"; // 05:30 America/Toronto
  console.log(`[coverage-kpi-cron] scheduled: ${expr} America/Toronto`);
  return cron.schedule(expr, async () => {
    console.log("[coverage-kpi-cron] tick");
    try { await runCoverageKpiSnapshot({}); }
    catch (e) { console.error("[coverage-kpi-cron] tick error:", e); }
  }, { timezone: "America/Toronto" });
}
