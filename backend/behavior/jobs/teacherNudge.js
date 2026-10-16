// backend/behavior/jobs/teacherNudge.js
//
// Bi-weekly teacher nudges (see sendTeacherNudgesForSchool in routes.js):
//   • proactive "students in your homeroom to check in with" email, and
//   • a gentle "how's it going?" note to teachers who've gone quiet.
// Runs every school day; each TEACHER is nudged at most once per intervalDays
// (default 14), and each day sends only its share of those due — spread over
// the week and kept inside the shared Resend budget.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { sendTeacherNudgesForSchool } from "../routes.js";

export async function runTeacherNudges() {
  const configs = await BehaviorConfig.find({ "teacherNudge.enabled": { $ne: false } }).select("schoolId").lean();
  let sent = 0;
  for (const c of configs) {
    try {
      const r = await sendTeacherNudgesForSchool(c.schoolId);
      if (r?.ok) sent += r.sent || 0;
    } catch (err) {
      console.warn("[behavior/nudge] school failed:", err?.message || err);
    }
  }
  if (sent) console.log(`[behavior/nudge] sent ${sent} teacher nudge email(s)`);
  return sent;
}

/** Register the daily (Mon–Fri 08:30 school-local) spread send. */
export function startTeacherNudges() {
  cron.schedule("30 8 * * 1-5", () => {
    runTeacherNudges().catch((err) => console.error("[behavior/nudge] tick failed:", err?.message || err));
  }, { timezone: process.env.SCHOOL_TZ || "America/Toronto" });
  console.log("[behavior] teacher-nudge scheduler started");
}
