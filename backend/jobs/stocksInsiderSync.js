// backend/jobs/stocksInsiderSync.js
//
// Nightly cron that pulls fresh SEC Form 4 filings for every held ticker
// + starred watchlist ticker across every user's portfolio. Runs at 3am
// ET — Form 4s for the previous business day are typically filed by
// then, so this catches everything without racing the SEC.
//
// Per-ticker: fetch recent filings (last 45d), persist new transactions,
// re-run cluster detection over the 30d window. All idempotent — safe
// to run more than once per day (cluster dedup is per (ticker, kind,
// UTC day)).

import cron from "node-cron";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";
import { syncInsiderForTicker, detectClusters } from "../services/stocksInsiderSignals.js";

const TZ = "America/New_York";

export async function runInsiderSyncOnce({ lookbackDays = 45 } = {}) {
  const startedAt = Date.now();
  // Collect the universe: unique tickers across every user's holdings +
  // starred discovery candidates. EDGAR only has US filings, so CAD-only
  // tickers will simply return no_cik and get skipped — that's fine.
  const [portfolios, starred] = await Promise.all([
    StocksPortfolio.find({ "positions.0": { $exists: true } }).select({ positions: 1 }).lean(),
    StocksDiscoveryCandidate.find({ starred: true, dismissed: { $ne: true } })
      .select({ ticker: 1 }).lean(),
  ]);
  const tickers = new Set();
  for (const p of portfolios) {
    for (const pos of p.positions || []) {
      if (pos?.ticker) tickers.add(String(pos.ticker).toUpperCase().replace(/\..*$/, ""));
    }
  }
  for (const s of starred) if (s.ticker) tickers.add(String(s.ticker).toUpperCase().replace(/\..*$/, ""));

  const universe = [...tickers];
  let inserted = 0, skipped = 0, failed = 0, signalsDetected = 0;

  // Serial with a small delay between tickers — SEC rate limit is 10/sec
  // and each ticker does N XML fetches, so we let the per-ticker throttle
  // dominate rather than doing the whole universe in parallel.
  for (const tk of universe) {
    try {
      const r = await syncInsiderForTicker(tk, { lookbackDays });
      if (r.ok) {
        inserted += r.inserted || 0;
        skipped += r.skipped || 0;
        const clusters = await detectClusters(tk).catch(() => []);
        signalsDetected += clusters.length;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      console.warn(`[insider-sync] ${tk} error: ${e?.message}`);
    }
  }
  const durationMs = Date.now() - startedAt;
  return {
    tickerCount: universe.length,
    inserted, skipped, failed, signalsDetected, durationMs,
  };
}

export function scheduleInsiderSync() {
  if (process.env.STOCKS_INSIDER_SYNC_ENABLED !== "1") {
    console.log("[insider-sync] disabled (set STOCKS_INSIDER_SYNC_ENABLED=1 to turn on)");
    return null;
  }
  console.log("[insider-sync] scheduled: 03:00 ET nightly");
  return cron.schedule("0 3 * * *", async () => {
    try {
      const stats = await runInsiderSyncOnce();
      console.log(`[insider-sync] done:`, stats);
    } catch (e) {
      console.error("[insider-sync] error:", e?.message);
    }
  }, { timezone: TZ });
}
