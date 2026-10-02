// backend/behavior/jobs/consequenceDigest.js
//
// Daily VP accountability digest (see sendConsequenceDigestForSchool in
// routes.js): a per-teacher list of consequences that were logged but aren't
// marked done yet, flagging ones past the fade window (default 2 days) as
// "missed" — a late consequence loses its effect. VP always; each teacher
// optionally. Each school's send is guarded once/day by consequenceDigest.lastSentAt.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { sendConsequenceDigestForSchool } from "../routes.js";

export async function runConsequenceDigests() {
  const configs = await BehaviorConfig.find({ "consequenceDigest.enabled": { $ne: false } }).select("schoolId").lean();
  let sent = 0;
  for (const c of configs) {
    try {
      const r = await sendConsequenceDigestForSchool(c.schoolId);
      if (r?.ok) sent += r.sent || 0;
    } catch (err) {
      console.warn("[behavior/consq-digest] school failed:", err?.message || err);
    }
  }
  if (sent) console.log(`[behavior/consq-digest] sent ${sent} consequence-digest email(s)`);
  return sent;
}

/** Register the daily send (07:30 America/Toronto ≈ 11:30 UTC); guarded per school. */
export function startConsequenceDigest() {
  cron.schedule("30 11 * * 1-5", () => {
    runConsequenceDigests().catch((err) => console.error("[behavior/consq-digest] tick failed:", err?.message || err));
  });
  console.log("[behavior] consequence-digest scheduler started");
}
