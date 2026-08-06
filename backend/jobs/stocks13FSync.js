// backend/jobs/stocks13FSync.js
//
// Weekly cron that walks the curated whale list and pulls each whale's
// most recent 13F-HR filing from SEC EDGAR (if we haven't persisted it
// already). 13Fs land 45 days after quarter-end and never intraday, so
// a Monday-morning weekly run catches everything without burning
// pointless requests the other six days.
//
// Fail-open per whale: SEC down / whale missed a quarter / XML
// malformed → skip that whale, continue the rest, log the reason. The
// briefing block reads whatever we've persisted regardless of freshness.

import cron from "node-cron";
import { WHALES, syncWhale } from "../services/stocks13F.js";

const TZ = "America/New_York";

export async function runSync() {
  const startedAt = Date.now();
  let ok = 0, dup = 0, failed = 0, newPositions = 0;
  const perWhale = [];
  for (const w of WHALES) {
    try {
      const r = await syncWhale({ cik: w.cik, name: w.name });
      if (r?.ok) {
        if (r.reason === "already_persisted" || r.reason === "dup_key") dup++;
        else {
          ok++;
          newPositions += r.newPositions || 0;
        }
      } else {
        failed++;
      }
      perWhale.push({ name: w.name, reason: r?.reason, ok: !!r?.ok });
    } catch (e) {
      failed++;
      console.warn(`[13f-sync] ${w.name} error:`, e?.message);
    }
  }
  const durationMs = Date.now() - startedAt;
  return { whaleCount: WHALES.length, ok, dup, failed, newPositions, durationMs, perWhale };
}

export function scheduleCron() {
  if (process.env.STOCKS_13F_SYNC_ENABLED !== "1") {
    console.log("[13f-sync] disabled (set STOCKS_13F_SYNC_ENABLED=1 to turn on)");
    return null;
  }
  console.log("[13f-sync] scheduled: 04:00 ET every Monday");
  // Monday 04:00 ET — well before the daily briefing 06:00 window,
  // so a fresh sync is visible in that morning's block.
  return cron.schedule("0 4 * * 1", async () => {
    try {
      const stats = await runSync();
      console.log(`[13f-sync] done:`, {
        whaleCount: stats.whaleCount,
        ok: stats.ok, dup: stats.dup, failed: stats.failed,
        newPositions: stats.newPositions, durationMs: stats.durationMs,
      });
    } catch (e) {
      console.error("[13f-sync] error:", e?.message);
    }
  }, { timezone: TZ });
}
