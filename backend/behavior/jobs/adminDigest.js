// backend/behavior/jobs/adminDigest.js
//
// Weekly admin digest scheduler. Once a week (Monday morning, server time) it
// sends each opted-in school's leadership a summary of the week. The send
// function itself guards against double-sends (lastSentAt), so a restart or an
// extra tick won't duplicate. Registered once from index.js.

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import { sendAdminDigestForSchool } from "../routes.js";

export async function runWeeklyDigests() {
  const configs = await BehaviorConfig.find({ "adminDigest.enabled": true }).select("schoolId").lean();
  let sent = 0;
  for (const c of configs) {
    try {
      const r = await sendAdminDigestForSchool(c.schoolId);
      if (r?.ok) sent += 1;
    } catch (err) {
      console.warn("[behavior/digest] school failed:", err?.message || err);
    }
  }
  if (sent) console.log(`[behavior/digest] sent ${sent} weekly digest(s)`);
  return sent;
}

/** Register the weekly scheduler (Mondays 13:00 UTC ≈ 8–9am ET). */
export function startAdminDigest() {
  cron.schedule("0 13 * * 1", () => {
    runWeeklyDigests().catch((err) => console.error("[behavior/digest] tick failed:", err?.message || err));
  });
  console.log("[behavior] weekly admin digest scheduler started");
}
