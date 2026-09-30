// backend/behavior/jobs/teacherNudge.js
//
// Bi-weekly teacher nudges (see sendTeacherNudgesForSchool in routes.js):
//   • proactive "students in your homeroom to check in with" email, and
//   • a gentle "how's it going?" note to teachers who've gone quiet.
// The cron runs weekly; each school's send is guarded by teacherNudge.lastRunAt
// against its intervalDays (default 14), so it effectively fires every 2 weeks.

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

/** Register the weekly check (Mondays 12:30 UTC); cadence guarded per school. */
export function startTeacherNudges() {
  cron.schedule("30 12 * * 1", () => {
    runTeacherNudges().catch((err) => console.error("[behavior/nudge] tick failed:", err?.message || err));
  });
  console.log("[behavior] teacher-nudge scheduler started");
}
