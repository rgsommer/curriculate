// backend/routes/subsTeacher.js
//
// Substitute-teacher API for /subs. Mounted at /api/subs-teacher.
//
// Signed-in (subs session) endpoints:
//   GET  /me                 — my teacher profile (auto-creates on first visit)
//   PUT  /profile            — update name / phone / contact preferences
//   GET  /offers             — my offers (pending first, then history)
//   POST /offers/:id/accept  — accept an offer I own
//   POST /offers/:id/decline — decline an offer I own
//
// Public, token-authenticated endpoint (for accept/decline links in the
// email/SMS — the unguessable token IS the credential, so no sign-in):
//   POST /respond  { token, action: "accept" | "decline" }
//   GET  /offer-by-token/:token  — render details on the respond page
//
// All acceptance/decline logic funnels through the shared escalation
// engine so the "first to accept wins, contacting stops" invariant holds.

import express from "express";
import mongoose from "mongoose";
import { requireSubsAuth } from "../services/subsAuthToken.js";
import SubsTeacher from "../models/SubsTeacher.js";
import SubsOffer from "../models/SubsOffer.js";
import SubsRequest, { URGENT_INTERVAL_MS, ADVANCE_INTERVAL_MS } from "../models/SubsRequest.js";
import SubsSchool from "../models/SubsSchool.js";
import SubsGradeLevel from "../models/SubsGradeLevel.js";
import SubsInvite from "../models/SubsInvite.js";
import SubsStaff from "../models/SubsStaff.js";
import SubsLessonPlan from "../models/SubsLessonPlan.js";
import SubsVoiceNote from "../models/SubsVoiceNote.js";
import { getSubsEngine } from "../jobs/subsEscalation.js";
import { decryptSecret } from "../services/subsCrypto.js";
import { notifier, sendTestSms } from "../services/subsNotify.js";
import { gradeVpContact, vpCanApprove } from "../services/subsVp.js";

const router = express.Router();
const jsonBody = express.json({ limit: "8kb" });
// Larger limit for the absence form, which may carry a short base64 voice clip.
const audioBody = express.json({ limit: "5mb" });

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

const SICK = (reason) => /sick/i.test(reason || "");

// Parse a "data:audio/...;base64,XXXX" URL into { mimeType, b64 }. Handles
// media-type parameters the browser adds (e.g. "audio/webm;codecs=opus",
// Safari's "audio/mp4"). Returns null if it isn't an audio data URL.
function parseAudioDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const idx = s.indexOf(";base64,");
  if (!s.startsWith("data:audio/") || idx === -1) return null;
  const mimeType = s.slice(5, idx); // everything after "data:" up to ;base64,
  const b64 = s.slice(idx + 8);
  if (!b64) return null;
  return { mimeType, b64 };
}

// Resolve the schools a teacher is registered with (multi-school view).
async function registeredSchools(teacher) {
  if (!teacher?.schoolIds?.length) return [];
  const schools = await SubsSchool.find({ _id: { $in: teacher.schoolIds } }).select("name abbrev location").lean();
  return schools;
}

// Enrich offers with the school/grade/date context the dashboards show.
async function decorateOffers(offers) {
  const reqIds = [...new Set(offers.map((o) => String(o.requestId)))];
  const requests = await SubsRequest.find({ _id: { $in: reqIds } }).lean();
  const reqById = new Map(requests.map((r) => [String(r._id), r]));
  const schoolIds = [...new Set(requests.map((r) => String(r.schoolId)))];
  const gradeIds = [...new Set(requests.map((r) => String(r.gradeLevelId)))];
  const [schools, grades] = await Promise.all([
    SubsSchool.find({ _id: { $in: schoolIds } }).select("name abbrev location address").lean(),
    SubsGradeLevel.find({ _id: { $in: gradeIds } }).select("name").lean(),
  ]);
  const schoolById = new Map(schools.map((s) => [String(s._id), s]));
  const gradeById = new Map(grades.map((g) => [String(g._id), g]));

  // Lesson-plan readiness so subs can see/filter by how complete a plan is.
  const planIds = requests.map((r) => r.lessonPlanId).filter(Boolean);
  const plans = planIds.length ? await SubsLessonPlan.find({ _id: { $in: planIds } }).select("completeness").lean() : [];
  const planById = new Map(plans.map((p) => [String(p._id), p]));

  return offers.map((o) => {
    const r = reqById.get(String(o.requestId));
    const school = r ? schoolById.get(String(r.schoolId)) : null;
    return {
      _id: o._id,
      status: o.status,
      rank: o.rank,
      sentAt: o.sentAt,
      expiresAt: o.expiresAt,
      respondedAt: o.respondedAt,
      paid: !!o.paid,
      request: r
        ? {
            _id: r._id,
            date: r.date,
            startTime: r.startTime,
            dayPart: r.dayPart || "full",
            endTime: r.endTime || "",
            urgency: r.urgency,
            status: r.status,
            notes: r.notes,
            requiredRole: r.requiredRole,
            requiredQualifications: r.requiredQualifications || [],
            supportLevel: r.supportLevel,
            schoolName: school?.name || "—",
            schoolAbbrev: school?.abbrev || "",
            schoolAddress: school?.address || "",
            gradeName: gradeById.get(String(r.gradeLevelId))?.name || "—",
            absentTeacherName: r.absentTeacher?.name || "",
            hasLessonPlan: !!r.lessonPlanId,
            lessonPlanCompleteness: r.lessonPlanId ? planById.get(String(r.lessonPlanId))?.completeness ?? 0 : null,
          }
        : null,
    };
  });
}

// ── Signed-in teacher routes ──────────────────────────────────────────

router.get("/me", requireSubsAuth, async (req, res) => {
  const email = req.subsUser.email;
  const teacher = await SubsTeacher.findOneAndUpdate(
    { email },
    { $setOnInsert: { email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ teacher, schools: await registeredSchools(teacher) });
});

// All schools this sub is registered with (multi-school view).
router.get("/my-schools", requireSubsAuth, async (req, res) => {
  const teacher = await SubsTeacher.findOne({ email: req.subsUser.email }).lean();
  res.json({ schools: await registeredSchools(teacher) });
});

const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : undefined);

router.put("/profile", requireSubsAuth, jsonBody, async (req, res) => {
  const email = req.subsUser.email;
  const b = req.body || {};
  const set = {};
  if (typeof b.name === "string") set.name = b.name.trim();
  if (typeof b.phone === "string") set.phone = b.phone.trim();
  if (typeof b.active === "boolean") set.active = b.active;
  if (b.contactPrefs && typeof b.contactPrefs === "object") {
    set["contactPrefs.email"] = b.contactPrefs.email !== false;
    set["contactPrefs.sms"] = !!b.contactPrefs.sms;
  }
  // Matching profile (challenges #1/#5/#10).
  if (arr(b.qualifications)) set.qualifications = arr(b.qualifications);
  if (arr(b.roleTypes)) set.roleTypes = arr(b.roleTypes).length ? arr(b.roleTypes) : ["teacher"];
  if (arr(b.gradeComfort)) set.gradeComfort = arr(b.gradeComfort);
  // Faith-fit self-declaration (challenge #11).
  if (b.faithFit && typeof b.faithFit === "object") {
    for (const k of ["statementOfFaith", "prayer", "christianEd", "values"]) {
      set[`faithFit.${k}`] = !!b.faithFit[k];
    }
  }
  // Proximity / availability (challenge #3).
  if (b.location && typeof b.location === "object") {
    set["location.address"] = typeof b.location.address === "string" ? b.location.address : "";
    if (Number.isFinite(b.location.lat)) set["location.lat"] = b.location.lat;
    if (Number.isFinite(b.location.lng)) set["location.lng"] = b.location.lng;
  }
  if (Number.isFinite(b.maxTravelKm)) set.maxTravelKm = b.maxTravelKm;
  if (Number.isFinite(b.dayRate)) set.dayRate = b.dayRate;
  if (typeof b.availabilityNote === "string") set["availability.note"] = b.availabilityNote;

  const teacher = await SubsTeacher.findOneAndUpdate(
    { email },
    { $set: set, $setOnInsert: { email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ teacher, schools: await registeredSchools(teacher) });
});

// Send a test SMS to a number so the user can confirm delivery from their
// profile. `mock: true` means no SMS provider is configured yet (the
// message was only logged server-side).
router.post("/test-sms", requireSubsAuth, jsonBody, async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  if (!phone) return res.status(400).json({ error: "Enter a phone number first." });
  try {
    const result = await sendTestSms(phone);
    res.json({ ok: true, mock: !!result?.mock, provider: result?.provider || null, messageId: result?.messageId || null, region: result?.region || null });
  } catch (e) {
    res.status(502).json({ error: e?.message || "Couldn't send the test SMS." });
  }
});

// Accept a school invite link. The token IS the proof the admin invited
// this email; we ensure registration and return all registered schools so
// the sub sees everywhere they serve.
router.post("/accept-invite", requireSubsAuth, jsonBody, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const invite = token ? await SubsInvite.findOne({ token }).lean() : null;
  if (!invite) return res.status(404).json({ error: "Invite not found or expired" });
  // Attach the school to whoever is signed in (the invite was emailed to
  // them); harmless if already attached.
  const teacher = await SubsTeacher.findOneAndUpdate(
    { email: req.subsUser.email },
    { $addToSet: { schoolIds: invite.schoolId }, $setOnInsert: { email: req.subsUser.email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  await SubsInvite.updateOne({ _id: invite._id }, { $set: { status: "accepted" } });
  res.json({ ok: true, schools: await registeredSchools(teacher) });
});

// ── Staff teacher: report my own absence ("I need a sub") ──────────────
// A regular classroom teacher submits a request; it sits in
// pending_approval until a principal approves (which fires the engine).
// We capture their email from the session, so no roster need exist first.

// Schools to pick from (names aren't sensitive). Used by the request form.
router.get("/all-schools", requireSubsAuth, async (req, res) => {
  const schools = await SubsSchool.find({}).select("name abbrev location requireSickVoiceNote").sort({ name: 1 }).lean();
  res.json({ schools });
});

// Grade levels for a chosen school (so the teacher can pick their class).
router.get("/schools/:id/grades", requireSubsAuth, async (req, res) => {
  if (!isOid(req.params.id)) return res.status(400).json({ error: "Bad school id" });
  const grades = await SubsGradeLevel.find({ schoolId: req.params.id }).select("name order").sort({ order: 1, name: 1 }).lean();
  res.json({ grades });
});

router.post("/request-sub", requireSubsAuth, audioBody, async (req, res) => {
  const email = req.subsUser.email;
  const b = req.body || {};
  if (!isOid(b.schoolId) || !isOid(b.gradeLevelId)) return res.status(400).json({ error: "Pick your school and class" });
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  const school = await SubsSchool.findById(b.schoolId).lean();
  if (!school) return res.status(404).json({ error: "School not found" });
  const grade = await SubsGradeLevel.findById(b.gradeLevelId).lean();
  if (!grade || String(grade.schoolId) !== String(b.schoolId)) return res.status(400).json({ error: "That class isn't at this school" });

  const reason = typeof b.reason === "string" ? b.reason.trim() : "";

  // Validate any attached voice note; enforce the school's sick-day policy.
  // If the teacher's recorder failed (mic denied / unsupported), we DON'T
  // block them — the request goes through flagged so the approver knows.
  let audio = null;
  if (b.voiceNote?.dataUrl) {
    audio = parseAudioDataUrl(b.voiceNote.dataUrl);
    if (!audio) return res.status(400).json({ error: "Voice note must be an audio recording" });
  }
  const voiceFailed = !!b.voiceNoteFailed;
  if (school.requireSickVoiceNote && SICK(reason) && !audio && !voiceFailed) {
    return res.status(400).json({ error: "This school requires a voice note for sick days — please record one." });
  }
  const voiceNoteStatus = audio ? "attached" : voiceFailed ? "failed" : "none";

  const urgency = b.urgency === "advance" ? "advance" : "urgent"; // sick → same-day default
  const request = await SubsRequest.create({
    schoolId: b.schoolId,
    gradeLevelId: b.gradeLevelId,
    division: grade?.division || "",
    date: b.date,
    urgency,
    escalationIntervalMs: urgency === "urgent" ? URGENT_INTERVAL_MS : ADVANCE_INTERVAL_MS,
    startTime: typeof b.startTime === "string" ? b.startTime : "",
    dayPart: ["full", "am", "pm", "custom"].includes(b.dayPart) ? b.dayPart : "full",
    endTime: typeof b.endTime === "string" ? b.endTime : "",
    source: "teacher",
    status: "pending_approval",
    reason,
    voiceNoteStatus,
    requestedByEmail: email,
    absentTeacher: { name: typeof b.name === "string" ? b.name.trim() : "", email },
    notes: typeof b.notes === "string" ? b.notes.trim() : "",
    currentRank: -1,
  });

  // Persist the voice note (if any) and link it to the request.
  if (audio) {
    const note = await SubsVoiceNote.create({
      requestId: request._id,
      schoolId: b.schoolId,
      mimeType: audio.mimeType,
      dataB64: audio.b64,
      durationSec: Number(b.voiceNote?.durationSec) || 0,
      createdByEmail: email,
    });
    await SubsRequest.updateOne({ _id: request._id }, { $set: { voiceNoteId: note._id } });
  }

  // Notify the school's principals/admins AND the appropriate VP that an
  // approval is waiting. The VP is texted only when it's their decision.
  const vp = gradeVpContact(grade, school);
  notifier
    .notifyApprovalNeeded({
      request: request.toObject(),
      school,
      gradeLevel: grade,
      absentTeacher: request.absentTeacher,
      adminEmails: school.adminEmails || [],
      vpEmail: vp.email,
      vpPhone: vp.phone,
      vpCanApprove: vpCanApprove(school, { reason }),
    })
    .catch((e) => console.error("[subs] notifyApprovalNeeded error:", e?.message || e));

  res.json({ ok: true, request: request.toObject() });
});

// Resolve a staff link to its school + grade list (for the join form, so
// the teacher can pick the grade they teach — which determines their VP).
router.get("/staff-invite/:token", requireSubsAuth, async (req, res) => {
  const school = await SubsSchool.findOne({ staffJoinToken: req.params.token }).lean();
  if (!school) return res.status(404).json({ error: "That staff link is invalid or expired" });
  const grades = await SubsGradeLevel.find({ schoolId: school._id }).select("name order vpEmail").sort({ order: 1, name: 1 }).lean();
  res.json({
    school: { _id: school._id, name: school.name, abbrev: school.abbrev, vpEmail: school.vpEmail || "" },
    grades: grades.map((g) => ({ _id: g._id, name: g.name, vpEmail: g.vpEmail || school.vpEmail || "" })),
  });
});

// Connect to a school via the principal's broadcast staff link (?staff=…).
// The teacher gives their name and grade level; storing the grade means the
// system knows their "appropriate VP" for absence handling.
router.post("/join-staff", requireSubsAuth, jsonBody, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const school = token ? await SubsSchool.findOne({ staffJoinToken: token }).lean() : null;
  if (!school) return res.status(404).json({ error: "That staff link is invalid or expired" });
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const set = {};
  if (name) set.name = name;
  if (isOid(req.body?.gradeLevelId)) set.gradeLevelId = req.body.gradeLevelId;
  await SubsStaff.findOneAndUpdate(
    { schoolId: school._id, email: req.subsUser.email },
    { $set: set, $setOnInsert: { schoolId: school._id, email: req.subsUser.email } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true, school: { _id: school._id, name: school.name, abbrev: school.abbrev } });
});

// Schools where the signed-in teacher is on staff (for the request form),
// each with the grade they teach so it can be pre-selected.
router.get("/my-staff-schools", requireSubsAuth, async (req, res) => {
  const staff = await SubsStaff.find({ email: req.subsUser.email }).lean();
  if (!staff.length) return res.json({ schools: [] });
  const schools = await SubsSchool.find({ _id: { $in: staff.map((s) => s.schoolId) } }).select("name abbrev location requireSickVoiceNote").lean();
  const gradeBySchool = new Map(staff.map((s) => [String(s.schoolId), s.gradeLevelId]));
  res.json({ schools: schools.map((s) => ({ ...s, myGradeLevelId: gradeBySchool.get(String(s._id)) || null })) });
});

// The signed-in teacher's own absence breakdown (challenge: teachers can
// see their breakdown too).
router.get("/my-absences", requireSubsAuth, async (req, res) => {
  const email = req.subsUser.email;
  const reqs = await SubsRequest.find({
    status: { $nin: ["denied", "cancelled"] },
    $or: [{ "absentTeacher.email": email }, { requestedByEmail: email }],
  }).sort({ date: -1 }).lean();
  const schoolIds = [...new Set(reqs.map((r) => String(r.schoolId)))];
  const gradeIds = [...new Set(reqs.map((r) => String(r.gradeLevelId)))];
  const [schools, grades] = await Promise.all([
    SubsSchool.find({ _id: { $in: schoolIds } }).select("name").lean(),
    SubsGradeLevel.find({ _id: { $in: gradeIds } }).select("name").lean(),
  ]);
  const sName = new Map(schools.map((s) => [String(s._id), s.name]));
  const gName = new Map(grades.map((g) => [String(g._id), g.name]));
  const byReason = {};
  for (const r of reqs) {
    const reason = r.reason || "Unspecified";
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  res.json({
    total: reqs.length,
    byReason,
    absences: reqs.map((r) => ({
      date: r.date,
      reason: r.reason || "Unspecified",
      status: r.status,
      schoolName: sName.get(String(r.schoolId)) || "—",
      gradeName: gName.get(String(r.gradeLevelId)) || "—",
    })),
  });
});

// A staff teacher's own submitted absence requests + their status.
router.get("/my-requests", requireSubsAuth, async (req, res) => {
  const reqs = await SubsRequest.find({ requestedByEmail: req.subsUser.email }).sort({ createdAt: -1 }).limit(50).lean();
  const schoolIds = [...new Set(reqs.map((r) => String(r.schoolId)))];
  const gradeIds = [...new Set(reqs.map((r) => String(r.gradeLevelId)))];
  const [schools, grades] = await Promise.all([
    SubsSchool.find({ _id: { $in: schoolIds } }).select("name abbrev").lean(),
    SubsGradeLevel.find({ _id: { $in: gradeIds } }).select("name").lean(),
  ]);
  const sName = new Map(schools.map((s) => [String(s._id), s.name]));
  const gName = new Map(grades.map((g) => [String(g._id), g.name]));
  res.json({
    requests: reqs.map((r) => ({
      _id: r._id,
      date: r.date,
      reason: r.reason,
      urgency: r.urgency,
      status: r.status,
      denyReason: r.denyReason,
      schoolName: sName.get(String(r.schoolId)) || "—",
      gradeName: gName.get(String(r.gradeLevelId)) || "—",
    })),
  });
});

router.get("/offers", requireSubsAuth, async (req, res) => {
  const teacher = await SubsTeacher.findOne({ email: req.subsUser.email }).lean();
  if (!teacher) return res.json({ offers: [] });
  const offers = await SubsOffer.find({ teacherId: teacher._id }).sort({ createdAt: -1 }).limit(100).lean();
  const decorated = await decorateOffers(offers);
  // Pending first, then most-recent history.
  decorated.sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0));
  res.json({ offers: decorated });
});

// Confirm the signed-in teacher owns this offer, then act through the engine.
async function ownedOffer(req, res) {
  const { id } = req.params;
  if (!isOid(id)) {
    res.status(400).json({ error: "Bad offer id" });
    return null;
  }
  const offer = await SubsOffer.findById(id).lean();
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return null;
  }
  const teacher = await SubsTeacher.findOne({ email: req.subsUser.email }).lean();
  if (!teacher || String(teacher._id) !== String(offer.teacherId)) {
    res.status(403).json({ error: "Not your offer" });
    return null;
  }
  return offer;
}

router.post("/offers/:id/accept", requireSubsAuth, async (req, res) => {
  const offer = await ownedOffer(req, res);
  if (!offer) return;
  const result = await getSubsEngine().accept(offer);
  if (!result.ok) return res.status(409).json({ error: humanizeReason(result.reason) });
  res.json({ ok: true });
});

router.post("/offers/:id/decline", requireSubsAuth, async (req, res) => {
  const offer = await ownedOffer(req, res);
  if (!offer) return;
  const result = await getSubsEngine().decline(offer);
  if (!result.ok) return res.status(409).json({ error: humanizeReason(result.reason) });
  res.json({ ok: true });
});

// Back out of an assignment already accepted — reopens the request and
// resumes contacting other subs.
router.post("/offers/:id/cancel", requireSubsAuth, async (req, res) => {
  const offer = await ownedOffer(req, res);
  if (!offer) return;
  const result = await getSubsEngine().cancelAcceptance(offer);
  if (!result.ok) return res.status(409).json({ error: humanizeReason(result.reason) });
  res.json({ ok: true });
});

// The sub marks a worked day as paid / unpaid (personal pay tracking).
router.post("/offers/:id/paid", requireSubsAuth, jsonBody, async (req, res) => {
  const offer = await ownedOffer(req, res);
  if (!offer) return;
  if (offer.status !== "accepted") return res.status(409).json({ error: "You can only mark assignments you worked." });
  const paid = req.body?.paid !== false;
  await SubsOffer.updateOne({ _id: offer._id }, { $set: { paid, paidAt: paid ? new Date() : null } });
  res.json({ ok: true, paid });
});

// Lesson plan for an offer the signed-in sub owns. Non-secret parts
// (system/username, completeness) are always visible so the sub can judge
// readiness before accepting; decrypted passwords are revealed ONLY once
// they've accepted the assignment (challenge #6 — least-privilege).
router.get("/offers/:id/lesson-plan", requireSubsAuth, async (req, res) => {
  const offer = await ownedOffer(req, res);
  if (!offer) return;
  const request = await SubsRequest.findById(offer.requestId).lean();
  if (!request?.lessonPlanId) return res.json({ plan: null });
  const plan = await SubsLessonPlan.findById(request.lessonPlanId).lean();
  if (!plan) return res.json({ plan: null });
  const reveal = offer.status === "accepted";
  res.json({
    plan: {
      _id: plan._id,
      body: plan.body,
      routineNotes: plan.routineNotes,
      materialsLinks: plan.materialsLinks,
      completeness: plan.completeness,
      credentials: (plan.credentials || []).map((c) => ({
        system: c.system,
        username: c.username,
        hasSecret: !!c.secretEnc,
        // Only the assigned (accepted) sub sees the password.
        secret: reveal && c.secretEnc ? safeDecrypt(c.secretEnc) : undefined,
      })),
    },
    revealed: reveal,
  });
});

function safeDecrypt(enc) {
  try {
    return decryptSecret(enc);
  } catch {
    return undefined; // never throw to client; never log
  }
}

// ── Public token-based respond (email/SMS links) ──────────────────────

router.get("/offer-by-token/:token", async (req, res) => {
  const offer = await SubsOffer.findOne({ token: req.params.token }).lean();
  if (!offer) return res.status(404).json({ error: "Offer not found" });
  const [decorated] = await decorateOffers([offer]);
  res.json({ offer: decorated });
});

router.post("/respond", jsonBody, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const action = req.body?.action;
  if (!token) return res.status(400).json({ error: "Missing token" });
  if (action !== "accept" && action !== "decline") return res.status(400).json({ error: "action must be accept or decline" });

  const offer = await SubsOffer.findOne({ token }).lean();
  if (!offer) return res.status(404).json({ error: "Offer not found" });

  const engine = getSubsEngine();
  const result = action === "accept" ? await engine.accept(offer) : await engine.decline(offer);
  if (!result.ok) return res.status(409).json({ error: humanizeReason(result.reason) });
  res.json({ ok: true, action });
});

function humanizeReason(reason) {
  if (reason === "offer_not_pending") return "This offer is no longer active — it may have expired or been answered.";
  if (reason === "request_closed") return "This assignment has already been filled or cancelled.";
  if (reason === "not_accepted") return "You can only cancel an assignment you've accepted.";
  if (reason === "not_the_filling_offer") return "This assignment can no longer be cancelled here.";
  return "Could not process this response.";
}

export default router;
