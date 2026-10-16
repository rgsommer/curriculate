// backend/behavior/jobs/monthlyTeacherSummary.js
//
// Monthly "your month in Compass" encouragement email to each teacher (see
// sendMonthlyTeacherSummaries in routes.js). Runs each school day from the 1st to
// the 10th, sending that day's share (spread + shared Resend budget); each
// teacher gets it once a month (BehaviorTeacher.monthlySummaryMonth).

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

/** Register the spread send (days 1–10, 08:00 school-local; weekends skipped in the sender). */
export function startMonthlyTeacherSummary() {
  cron.schedule("0 8 1-10 * *", () => {
    runMonthlyTeacherSummaries().catch((err) => console.error("[behavior/monthly-summary] tick failed:", err?.message || err));
  }, { timezone: process.env.SCHOOL_TZ || "America/Toronto" });
  console.log("[behavior] monthly-teacher-summary scheduler started");
}
