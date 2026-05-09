/**
 * Server-coordinated stopwatch routes.
 *
 *   GET  /clock                                  — server time, used for skew calibration
 *   POST /events/:id/timer/start                 — { competitorId, startedAt, startedBy }
 *   POST /events/:id/timer/stop                  — { competitorId, stoppedAt }
 *   POST /events/:id/timer/start-all             — { startedAt, startedBy } (mass start, every empty slot)
 *   POST /events/:id/timer/reset                 — clears liveTimers without recording (false-start)
 *
 * Design notes:
 *   - All timestamps are SERVER-CLOCK milliseconds. Clients calibrate their
 *     own clock skew against /clock at boot and then send `Date.now() + skew`
 *     when they tap Start/Stop. This keeps network latency OUT of the
 *     measurement: the moment the user taps is captured locally before the
 *     network call, and the request can take any amount of time without
 *     changing the recorded elapsed.
 *   - On Stop, server computes elapsed = stoppedAt - startedAt and writes
 *     into the next empty attempt slot (same fallback rule as the local
 *     stopRowTimer used). If the row already has the slot full, we overwrite
 *     the last slot — matches existing behaviour.
 *   - Any leader can stop any timer started by any other leader. There is no
 *     "ownership" of a running clock; in a field-day context it's totally
 *     normal for the helper at the start line to tap Start and the helper at
 *     the finish line to tap Stop.
 */
import express from "express";
import { Event, School } from "../models.js";
import { errResp, asyncH, publicEvent } from "../utils.js";
import { requireSchool } from "../auth.js";

const router = express.Router();

/**
 * Anyone signed into the school can STOP any clock — that's the field-day
 * reality where the helper at the finish line wasn't always the one who
 * pressed Start. The starting/resetting permission is governed by the
 * school setting `restrictTimerStarts`:
 *
 *   - false (default): any helper can Start/Reset.
 *   - true:  only the event's assigned leader (or an admin) can Start/Reset.
 *            Stop stays open to everyone in both modes.
 */
function isAssignedLeader(req, ev) {
  if (!ev) return false;
  if (req.fdSession.role === "admin") return true;
  return (ev.leaderName || "").trim().toLowerCase() ===
         (req.fdSession.leaderName || "").trim().toLowerCase();
}

async function canStartOrReset(req, ev) {
  if (!ev) return false;
  if (req.fdSession.role === "admin") return true;
  // Look up the school to read the restrictTimerStarts toggle.
  const school = await School.findById(req.fdSchoolId).lean();
  if (school?.restrictTimerStarts) {
    return isAssignedLeader(req, ev);
  }
  // Default loose mode — any helper can.
  return !!req.fdSession;
}

/** Stop is always loose — anyone signed into the school can stop a clock. */
function canStop(req, ev) {
  if (!ev) return false;
  return !!req.fdSession;
}

/* GET /clock — server's current epoch ms. Public-ish; auth is fine because
 * /api/* sits behind the session middleware on most routes anyway, but this
 * endpoint deliberately doesn't require a school so the very first sign-in
 * page can also calibrate. */
router.get("/clock", (req, res) => {
  res.json({ serverTime: Date.now() });
});

/* POST /events/:id/timer/start { competitorId, startedAt, startedBy } */
router.post("/events/:id/timer/start", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!(await canStartOrReset(req, ev))) return errResp(res, 403, "forbidden");
  const { competitorId, startedAt, startedBy } = req.body || {};
  if (!competitorId) return errResp(res, 400, "missing_competitorId");
  const c = ev.competitors.find(x => x.id === competitorId);
  if (!c) return errResp(res, 404, "competitor_not_found");

  ev.liveTimers = ev.liveTimers || {};
  // Idempotent: if a timer is already running for this competitor we keep
  // the original startedAt (so two helpers tapping Start in quick succession
  // doesn't reset the clock).
  if (!ev.liveTimers[competitorId]) {
    ev.liveTimers[competitorId] = {
      startedAt: Number(startedAt) || Date.now(),
      startedBy: String(startedBy || req.fdSession.leaderName || req.fdSession.email || "")
    };
    ev.markModified("liveTimers");
    await ev.save();
  }
  res.json({ event: publicEvent(ev) });
}));

/* POST /events/:id/timer/stop { competitorId, stoppedAt } */
router.post("/events/:id/timer/stop", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canStop(req, ev)) return errResp(res, 403, "forbidden");
  const { competitorId, stoppedAt } = req.body || {};
  if (!competitorId) return errResp(res, 400, "missing_competitorId");
  const c = ev.competitors.find(x => x.id === competitorId);
  if (!c) return errResp(res, 404, "competitor_not_found");

  ev.liveTimers = ev.liveTimers || {};
  const live = ev.liveTimers[competitorId];
  if (!live) {
    // Already stopped by another helper — don't error, just return current state.
    return res.json({ event: publicEvent(ev), already: true });
  }
  const stopMs = Number(stoppedAt) || Date.now();
  const elapsedMs = Math.max(0, stopMs - Number(live.startedAt || 0));
  // Round to centiseconds (matches existing local stopwatch behaviour).
  const seconds = Math.round(elapsedMs / 10) / 100;

  // Find the next empty attempt slot; overwrite the last one if every slot is full.
  const slot = (c.attempts || []).findIndex(v => v == null || v === "");
  const idx = slot >= 0 ? slot : Math.max(0, (c.attempts || []).length - 1);
  while (c.attempts.length <= idx) c.attempts.push(null);
  c.attempts[idx] = seconds;

  // Remove this row's live timer so other clients see it stop.
  delete ev.liveTimers[competitorId];
  ev.markModified("liveTimers");
  ev.markModified("competitors");
  await ev.save();

  res.json({
    event: publicEvent(ev),
    competitor: c.toObject ? c.toObject() : c,
    elapsedSeconds: seconds,
    attemptIdx: idx
  });
}));

/* POST /events/:id/timer/start-all { startedAt, startedBy }
 * Starts a timer for every competitor in the event who:
 *   - has at least one empty attempt slot, AND
 *   - is not DQ'd, AND
 *   - is not already running.
 * Useful for mass-start races (gun fires, every runner's clock starts at
 * the same server-pinned instant). */
router.post("/events/:id/timer/start-all", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!(await canStartOrReset(req, ev))) return errResp(res, 403, "forbidden");
  const startedAt = Number(req.body?.startedAt) || Date.now();
  const startedBy = String(req.body?.startedBy || req.fdSession.leaderName || req.fdSession.email || "");

  ev.liveTimers = ev.liveTimers || {};
  let started = 0;
  for (const c of ev.competitors || []) {
    if (c.dq) continue;
    const hasEmpty = (c.attempts || []).some(v => v == null || v === "");
    if (!hasEmpty) continue;
    if (ev.liveTimers[c.id]) continue;
    ev.liveTimers[c.id] = { startedAt, startedBy };
    started++;
  }
  ev.markModified("liveTimers");
  await ev.save();
  res.json({ event: publicEvent(ev), started });
}));

/* POST /events/:id/timer/reset
 * Clears every running timer in this event WITHOUT recording. For false starts. */
router.post("/events/:id/timer/reset", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!(await canStartOrReset(req, ev))) return errResp(res, 403, "forbidden");
  ev.liveTimers = {};
  ev.markModified("liveTimers");
  await ev.save();
  res.json({ event: publicEvent(ev) });
}));

export default router;
