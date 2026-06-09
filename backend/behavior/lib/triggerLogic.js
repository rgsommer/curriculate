// backend/behavior/lib/triggerLogic.js
//
// PURE, DB-FREE trigger evaluation — the heart of the system (brief §1, §6).
// Keeping it pure means the cross-teacher aggregation, fade window, and CC-VP
// rules are unit-testable in isolation, with no Mongo required. The route layer
// fetches the incident rows and calls into here.
//
// Core invariant: counts aggregate PER STUDENT across ALL teachers. Nothing in
// here is keyed by teacher.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is an incident still inside the fade window relative to `asOf`?
 * Incidents older than fadeWindowDays no longer count toward the threshold.
 */
export function isWithinFadeWindow(incident, fadeWindowDays, asOf) {
  const t = new Date(incident.timestamp).getTime();
  const cutoff = asOf.getTime() - fadeWindowDays * DAY_MS;
  return t > cutoff;
}

/**
 * The student's ACTIVE THRESHOLD count: THRESHOLD-mode incidents that are
 *   (a) within the fade window, and
 *   (b) logged after the last counter reset (thresholdResetAt), and
 *   (c) not already attributed to a prior notice.
 *
 * History before the reset is kept on the records but excluded here.
 *
 * @param {Array} incidents  all of the student's incidents (any order)
 * @param {object} opts      { fadeWindowDays, thresholdResetAt, asOf }
 * @returns {Array} the contributing incidents (newest-last), length = the count
 */
export function activeThresholdIncidents(incidents, { fadeWindowDays, thresholdResetAt, asOf }) {
  const now = asOf || new Date();
  const resetAt = thresholdResetAt ? new Date(thresholdResetAt).getTime() : 0;
  return incidents
    .filter((inc) => {
      const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
      if (mode !== "THRESHOLD") return false;
      if (inc.countedInNoticeId) return false; // already spent on a prior notice
      if (new Date(inc.timestamp).getTime() <= resetAt) return false;
      return isWithinFadeWindow(inc, fadeWindowDays, now);
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Decide whether logging `newIncident` should fire a notice home.
 *
 * @param {object} args
 *   newIncident      the incident just logged (with behaviorSnapshot)
 *   priorIncidents   the student's other incidents (excluding newIncident)
 *   config           { triggerCount, fadeWindowDays }
 *   student          { thresholdResetAt, noticesHomeCount }
 *   asOf             evaluation time (defaults to now)
 *
 * @returns {object}
 *   shouldNotify     boolean
 *   reason           "immediate" | "threshold" | null
 *   contributingIncidents  the incidents that make up this notice (for "from
 *                          teachers" + AI context); for IMMEDIATE, just the one
 *   sequenceNo       1-based notice number this period (drives 1st/2nd wording)
 *   ccVp             true when sequenceNo >= 2 (CC-VP rule, §7)
 */
export function evaluateIncident({ newIncident, priorIncidents, config, student, asOf }) {
  const now = asOf || new Date();
  const triggerCount = config.triggerCount ?? 3;
  const fadeWindowDays = config.fadeWindowDays ?? 30;

  const mode =
    newIncident.behaviorSnapshot?.triggerMode || (newIncident.immediateFlag ? "IMMEDIATE" : "THRESHOLD");

  // Next notice's sequence number this period drives tone + the CC-VP rule.
  const sequenceNo = (student?.noticesHomeCount || 0) + 1;
  const ccVp = sequenceNo >= 2;

  // IMMEDIATE: a single occurrence notifies right away. The notice carries this
  // offence PLUS any THRESHOLD incidents already accumulating in the queue, so
  // the parent note reflects everything outstanding (and the queue resets).
  if (mode === "IMMEDIATE") {
    const queued = activeThresholdIncidents([...priorIncidents, newIncident], {
      fadeWindowDays,
      thresholdResetAt: student?.thresholdResetAt,
      asOf: now,
    });
    return {
      shouldNotify: true,
      reason: "immediate",
      contributingIncidents: [newIncident, ...queued],
      sequenceNo,
      ccVp,
    };
  }

  // THRESHOLD: count active incidents (prior + this new one) for the student.
  const active = activeThresholdIncidents([...priorIncidents, newIncident], {
    fadeWindowDays,
    thresholdResetAt: student?.thresholdResetAt,
    asOf: now,
  });

  if (active.length >= triggerCount) {
    return {
      shouldNotify: true,
      reason: "threshold",
      contributingIncidents: active,
      sequenceNo,
      ccVp,
    };
  }

  return { shouldNotify: false, reason: null, contributingIncidents: [], sequenceNo, ccVp };
}

/**
 * Repeat-escalation multiplier for a behaviour's consequence (brief §5a).
 * Same student + same behaviour within the repeat scope: 1st = ×1, 2nd = ×2,
 * 3rd = ×3, then held at the cap (default ×3).
 *
 * @param priorSameBehaviorCount  how many prior incidents of the SAME behaviour
 *                                this student has within the repeat scope
 * @param cap                     escalationCapMultiplier (default 3)
 * @returns the multiplier to apply to THIS occurrence
 */
export function repeatMultiplier(priorSameBehaviorCount, cap = 3) {
  const occurrence = (priorSameBehaviorCount || 0) + 1; // 1-based: this is the Nth
  return Math.min(occurrence, cap);
}
