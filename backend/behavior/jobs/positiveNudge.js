// backend/behavior/jobs/positiveNudge.js
//
// Weekly "catch them being good" nudge (see sendPositiveNudges in routes.js).
// Runs every school day at 15:30 school-local and sends that day's SHARE of the
// teachers due this week — spread over the week and kept inside the shared
// Resend budget; each teacher is nudged at most once a week.

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

/** Register the daily (Mon–Fri 15:30 school-local) spread send. */
export function startPositiveNudges() {
  cron.schedule(
    "30 15 * * 1-5",
    () => { runPositiveNudges().catch((err) => console.error("[behavior/positive-nudge] tick failed:", err?.message || err)); },
    { timezone: SCHOOL_TZ }
  );
  console.log("[behavior] weekly encouragement-nudge scheduler started");
}
