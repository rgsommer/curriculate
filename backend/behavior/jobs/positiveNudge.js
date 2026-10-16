// backend/behavior/jobs/positiveNudge.js
//
// Weekly "catch them being good" nudge (see sendPositiveNudges in routes.js):
// Thursday 15:30 school-local, so teachers still have Friday. Each school's send
// is guarded once per week by positiveNudge.lastRunWeek.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { sendPositiveNudges } from "../routes.js";

const SCHOOL_TZ = process.env.SCHOOL_TZ || "America/Toronto";

export async function runPositiveNudges() {
  const configs = await BehaviorConfig.find({ "positiveNudge.enabled": { $ne: false } }).select("schoolId").lean();
  let sent = 0;
  for (const c of configs) {
    try {
      const r = await sendPositiveNudges(c.schoolId);
      if (r?.ok) sent += r.sent || 0;
    } catch (err) {
      console.warn("[behavior/positive-nudge] school failed:", err?.message || err);
    }
  }
  if (sent) console.log(`[behavior/positive-nudge] sent ${sent} encouragement nudge email(s)`);
  return sent;
}

/** Register the weekly send (Thursday 15:30 school-local); guarded per school. */
export function startPositiveNudges() {
  cron.schedule(
    "30 15 * * 4",
    () => { runPositiveNudges().catch((err) => console.error("[behavior/positive-nudge] tick failed:", err?.message || err)); },
    { timezone: SCHOOL_TZ }
  );
  console.log("[behavior] weekly encouragement-nudge scheduler started");
}
