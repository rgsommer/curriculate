// backend/behavior/jobs/guddReset.js
//
// Weekly GUDD auto-reset. Schools that opt in (gudd.autoResetFriday) have their
// GUDD list cleared every Friday at end of the school day, so staff don't have to
// come back in to reset it. "Clearing" just stamps gudd.resetAt = now; earlier
// uniform infractions stay in history but stop counting toward the new period.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";

const SCHOOL_TZ = process.env.SCHOOL_TZ || "America/Toronto";

export async function runGuddFridayReset() {
  const at = new Date();
  const r = await BehaviorConfig.updateMany(
    { "gudd.autoResetFriday": true, "gudd.enabled": { $ne: false } },
    { $set: { "gudd.resetAt": at } }
  );
  const n = r.modifiedCount ?? r.nModified ?? 0;
  if (n) console.log(`[behavior/gudd] Friday auto-clear: reset GUDD for ${n} school(s)`);
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
