// backend/behavior/jobs/guddReset.js
//
// Weekly GUDD auto-reset. Schools that opt in (gudd.autoResetFriday) have their
// GUDD list cleared every Friday at end of the school day, so staff don't have to
// come back in to reset it. "Clearing" just stamps gudd.resetAt = now; earlier
// uniform infractions stay in history but stop counting toward the new period.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { awardGuddAndReset } from "../lib/guddAward.js";

const SCHOOL_TZ = process.env.SCHOOL_TZ || "America/Toronto";

export async function runGuddFridayReset() {
  // Per-school so recycling the list also awards the dress-down house points
  // (fewest excluded members → 1st/2nd/3rd) before the period is stamped fresh.
  const configs = await BehaviorConfig.find({ "gudd.autoResetFriday": true, "gudd.enabled": { $ne: false } }).lean();
  let n = 0, awardedSchools = 0;
  for (const cfg of configs) {
    try {
      const { awarded } = await awardGuddAndReset(cfg.schoolId, cfg);
      n += 1;
      if (awarded && awarded.length) awardedSchools += 1;
    } catch (err) {
      console.error(`[behavior/gudd] Friday reset failed for school ${cfg.schoolId}:`, err?.message || err);
    }
  }
  if (n) console.log(`[behavior/gudd] Friday auto-clear: reset GUDD for ${n} school(s); awarded dress-down points at ${awardedSchools}`);
  return n;
}

/** Register the Friday end-of-day GUDD reset (16:00 school-local). */
export function startGuddAutoReset() {
  cron.schedule(
    "0 16 * * 5",
    () => { runGuddFridayReset().catch((err) => console.error("[behavior/gudd] Friday reset tick failed:", err?.message || err)); },
    { timezone: SCHOOL_TZ }
  );
  console.log("[behavior] GUDD Friday auto-reset scheduler started");
}
