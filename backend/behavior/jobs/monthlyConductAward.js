// backend/behavior/jobs/monthlyConductAward.js
//
// Fires the month-end conduct award (see lib/monthlyConductAward.js) on the last
// SCHOOL day of each month. Runs daily in the afternoon; for each opted-in
// school it checks whether today is that school's last school day of the month
// (respecting weekends, Ontario stat holidays and admin-set non-school days) and
// awards if so. Idempotent per month, so a duplicate run is harmless.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { awardMonthlyConduct, isLastSchoolDayOfMonth } from "../lib/monthlyConductAward.js";

const SCHOOL_TZ = process.env.SCHOOL_TZ || "America/Toronto";

export async function runMonthlyConductAward(now = new Date()) {
  const configs = await BehaviorConfig.find({ "monthlyConductAward.enabled": { $ne: false } }).lean();
  let awardedSchools = 0;
  for (const cfg of configs) {
    try {
      if (!isLastSchoolDayOfMonth(now, cfg.manualNonSchoolDays || [])) continue;
      const { awarded } = await awardMonthlyConduct(cfg.schoolId, cfg, { now });
      if (awarded && awarded.length) awardedSchools += 1;
    } catch (err) {
      console.error(`[behavior/conduct] Monthly award failed for school ${cfg.schoolId}:`, err?.message || err);
    }
  }
  if (awardedSchools) console.log(`[behavior/conduct] Month-end conduct award granted at ${awardedSchools} school(s)`);
  return awardedSchools;
}

/** Register the month-end conduct award check (16:10 school-local, daily). */
export function startMonthlyConductAward() {
  cron.schedule(
    "10 16 * * *",
    () => { runMonthlyConductAward().catch((err) => console.error("[behavior/conduct] Monthly award tick failed:", err?.message || err)); },
    { timezone: SCHOOL_TZ }
  );
  console.log("[behavior] Month-end conduct award scheduler started");
}
