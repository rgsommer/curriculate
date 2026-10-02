// backend/behavior/jobs/monthlyTeacherSummary.js
//
// Monthly "your month in Compass" encouragement email to each teacher (see
// sendMonthlyTeacherSummaries in routes.js). Runs on the 1st of each month;
// each school's send is guarded once-per-month by monthlyTeacherSummary.lastRunMonth.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { sendMonthlyTeacherSummaries } from "../routes.js";

export async function runMonthlyTeacherSummaries() {
  const configs = await BehaviorConfig.find({ "monthlyTeacherSummary.enabled": { $ne: false } }).select("schoolId").lean();
  let sent = 0;
  for (const c of configs) {
    try {
      const r = await sendMonthlyTeacherSummaries(c.schoolId);
      if (r?.ok) sent += r.sent || 0;
    } catch (err) {
      console.warn("[behavior/monthly-summary] school failed:", err?.message || err);
    }
  }
  if (sent) console.log(`[behavior/monthly-summary] sent ${sent} teacher summary email(s)`);
  return sent;
}

/** Register the monthly send (1st of the month, 12:00 UTC); guarded per school. */
export function startMonthlyTeacherSummary() {
  cron.schedule("0 12 1 * *", () => {
    runMonthlyTeacherSummaries().catch((err) => console.error("[behavior/monthly-summary] tick failed:", err?.message || err));
  });
  console.log("[behavior] monthly-teacher-summary scheduler started");
}
