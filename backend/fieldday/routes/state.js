/**
 * Aggregated state + school settings + admin code-change + invite.
 *
 *   GET   /state
 *   PATCH /schools/me
 *   POST  /schools/me/code-change-request
 *   POST  /schools/me/code-change
 *   POST  /schools/me/invite-admin
 */
const express = require("express");
const { School, Event, CodeChange } = require("../models");
const { gen6, hash, verify, codeChangeExpiresAt, errResp, asyncH, publicSchool, publicEvent } = require("../utils");
const { sendCodeChangeEmail, sendInviteEmail } = require("../email");
const { requireSchool } = require("../auth");

const router = express.Router();

/* GET /state — full snapshot for current session's active school */
router.get("/state", asyncH(async (req, res) => {
  const sess = req.fdSession;
  if (!sess?.schoolId) return res.json({ school: null, events: [], announceQueue: [] });

  const school = await School.findById(sess.schoolId).lean();
  if (!school) return res.json({ school: null, events: [], announceQueue: [] });

  const evQuery = { schoolId: school._id };
  // Leaders see only events that match their name OR whose staff list includes them.
  // We let the client filter the deeper case so we don't have to scan eventStaff per query.
  const events = await Event.find(evQuery).sort({ updatedAt: -1 }).lean();

  // Announce queue = completed events that haven't been announced, ordered by completedAt.
  const announceQueue = events
    .filter(e => e.status === "completed" && !e.announcedAt)
    .sort((a, b) => (a.announceQueuePosition ?? a.completedAt ?? 0) - (b.announceQueuePosition ?? b.completedAt ?? 0))
    .map(e => e._id.toString());

  res.json({
    school: publicSchool(school),
    events: events.map(publicEvent),
    announceQueue
  });
}));

/* PATCH /schools/me — partial update of any school setting */
router.patch("/schools/me", requireSchool, asyncH(async (req, res) => {
  if (req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  const allowed = [
    "name", "ageCategories", "ageBands", "ageCutoffDate",
    "eventLibrary", "eventDefaults", "eventRules", "eventStaff",
    "divisions", "houses", "tieMethod", "scoring",
    "records", "standards", "personalBests"
  ];
  const set = {};
  allowed.forEach(k => { if (k in req.body) set[k] = req.body[k]; });
  if (Object.keys(set).length === 0) return errResp(res, 400, "nothing_to_update");
  const school = await School.findByIdAndUpdate(req.fdSchoolId, { $set: set }, { new: true });
  res.json({ school: publicSchool(school) });
}));

/* POST /schools/me/code-change-request — emails master admin a confirmation code */
router.post("/schools/me/code-change-request", requireSchool, asyncH(async (req, res) => {
  if (req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  const school = await School.findById(req.fdSchoolId);
  if (!school) return errResp(res, 404, "school_not_found");

  const code = gen6();
  await CodeChange.findOneAndUpdate(
    { schoolId: school._id },
    { confirmationHash: await hash(code), expiresAt: codeChangeExpiresAt() },
    { upsert: true }
  );

  let sent = true;
  try { await sendCodeChangeEmail(school.masterAdminEmail, code, school.name); }
  catch (e) { sent = false; }

  const out = { confirmationSent: sent, masterAdminEmail: school.masterAdminEmail };
  if (process.env.FIELDDAY_DEV_ECHO_PASSKEY === "1") out.devConfirmationCode = code;
  res.json(out);
}));

/* POST /schools/me/code-change { newCode, confirmationCode } */
router.post("/schools/me/code-change", requireSchool, asyncH(async (req, res) => {
  if (req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  const newCode      = String(req.body?.newCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const confirmation = String(req.body?.confirmationCode || "").trim();
  if (newCode.length < 3 || !confirmation) return errResp(res, 400, "missing_fields");

  const pending = await CodeChange.findOne({ schoolId: req.fdSchoolId });
  if (!pending) return errResp(res, 401, "no_pending_request");
  const ok = await verify(confirmation, pending.confirmationHash);
  if (!ok) return errResp(res, 401, "bad_confirmation");

  const dup = await School.findOne({ code: newCode, _id: { $ne: req.fdSchoolId } }).lean();
  if (dup) return errResp(res, 409, "code_taken");

  const school = await School.findByIdAndUpdate(req.fdSchoolId, { code: newCode }, { new: true });
  await CodeChange.deleteOne({ schoolId: req.fdSchoolId });
  res.json({ school: publicSchool(school) });
}));

/* POST /schools/me/invite-admin { email } */
router.post("/schools/me/invite-admin", requireSchool, asyncH(async (req, res) => {
  if (req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return errResp(res, 400, "bad_email");

  const school = await School.findById(req.fdSchoolId).lean();
  let sent = true;
  try { await sendInviteEmail(email, school.name, school.code, req.fdSession.email); }
  catch (e) { sent = false; }
  res.json({ sent });
}));

module.exports = router;
