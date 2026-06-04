// backend/routes/subsAdmin.js
//
// School-admin API for /subs. Every route requires a valid subs session;
// routes scoped to a school additionally require the signed-in email to
// be on that school's adminEmails list.
//
// Mounted at /api/subs-admin. Endpoints:
//   GET    /schools                         — schools I administer
//   POST   /schools                         — create a school (I become admin)
//   POST   /schools/:id/admins              — add another admin email
//   GET    /schools/:id/grades              — list grade levels
//   POST   /schools/:id/grades              — add a grade level
//   GET    /teachers                        — the shared substitute pool
//   POST   /teachers                        — add/upsert a substitute
//   GET    /schools/:id/grades/:gid/ranking — ordered preferred subs
//   PUT    /schools/:id/grades/:gid/ranking — set ordered preferred subs
//   POST   /requests                        — post a sub request (starts engine)
//   GET    /schools/:id/requests            — requests + live status/offers
//   POST   /requests/:rid/cancel            — cancel an open request
//   POST   /dev/tick                        — force one escalation sweep (dev)

import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { requireSubsAuth } from "../services/subsAuthToken.js";
import SubsSchool from "../models/SubsSchool.js";
import SubsGradeLevel from "../models/SubsGradeLevel.js";
import SubsTeacher from "../models/SubsTeacher.js";
import SubsRanking from "../models/SubsRanking.js";
import SubsRequest, { URGENT_INTERVAL_MS, ADVANCE_INTERVAL_MS } from "../models/SubsRequest.js";
import SubsOffer from "../models/SubsOffer.js";
import SubsLessonPlan from "../models/SubsLessonPlan.js";
import SubsInternalCoverage, { COVERAGE_TYPES } from "../models/SubsInternalCoverage.js";
import SubsReliabilityFeedback from "../models/SubsReliabilityFeedback.js";
import SubsInvite from "../models/SubsInvite.js";
import SubsStaff from "../models/SubsStaff.js";
import SubsVoiceNote from "../models/SubsVoiceNote.js";
import { getSubsEngine, tickNow } from "../jobs/subsEscalation.js";
import { notifier } from "../services/subsNotify.js";
import { isEligible, eligibilityReasons } from "../services/subsMatching.js";
import { smartMatch } from "../services/subsSmartMatch.js";
import { encryptSecret, decryptSecret, encryptionAvailable } from "../services/subsCrypto.js";

const router = express.Router();

const APP_BASE_URL = process.env.SUBS_BASE_URL || "https://curriculate.net/subs";

// 0..1 readiness so subs see how complete a plan is (challenge #6).
function planCompleteness(p) {
  let s = 0;
  if (p.body && p.body.trim()) s += 0.5;
  if (p.routineNotes && p.routineNotes.trim()) s += 0.25;
  if ((p.materialsLinks || []).length) s += 0.25;
  return Math.round(s * 100) / 100;
}

// Build a SubsLessonPlan from request-body input, encrypting any secrets.
async function createLessonPlanDoc({ schoolId, input }) {
  const credentials = [];
  for (const c of input.credentials || []) {
    const cred = { system: c.system || "", username: c.username || "" };
    if (c.secret) {
      if (!encryptionAvailable()) throw new Error("SUBS_ENCRYPTION_KEY not set — cannot store lesson-plan passwords securely");
      cred.secretEnc = encryptSecret(c.secret);
    }
    credentials.push(cred);
  }
  const doc = {
    schoolId,
    body: input.body || "",
    routineNotes: input.routineNotes || "",
    materialsLinks: Array.isArray(input.materialsLinks) ? input.materialsLinks.filter(Boolean) : [],
    credentials,
  };
  doc.completeness = planCompleteness(doc);
  return SubsLessonPlan.create(doc);
}

// Remember a class's usual requirements on the absent teacher's staff
// record, so the next request for them pre-fills role + qualifications.
async function rememberStaffDefaults(schoolId, email, role, quals) {
  if (!email) return;
  await SubsStaff.findOneAndUpdate(
    { schoolId, email },
    { $set: { defaultRole: role || "teacher", defaultRequiredQualifications: Array.isArray(quals) ? quals : [] }, $setOnInsert: { schoolId, email } },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch((e) => console.error("[subs] rememberStaffDefaults", e?.message || e));
}

router.use(requireSubsAuth);
router.use(express.json({ limit: "32kb" }));

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function isOid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Load the school in :id and confirm the caller administers it.
async function loadAdminSchool(req, res, next) {
  const { id } = req.params;
  if (!isOid(id)) return res.status(400).json({ error: "Bad school id" });
  const school = await SubsSchool.findById(id).lean();
  if (!school) return res.status(404).json({ error: "School not found" });
  if (!(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  req.school = school;
  next();
}

// ── Schools ───────────────────────────────────────────────────────────

router.get("/schools", async (req, res) => {
  const schools = await SubsSchool.find({ adminEmails: req.subsUser.email }).sort({ name: 1 }).lean();
  res.json({ schools });
});

router.post("/schools", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "School name is required" });
  const location = typeof req.body?.location === "string" ? req.body.location.trim() : "";
  const abbrev = typeof req.body?.abbrev === "string" ? req.body.abbrev.trim().slice(0, 8) : "";
  const school = await SubsSchool.create({ name, location, abbrev, adminEmails: [req.subsUser.email] });
  res.json({ school: school.toObject() });
});

// Update school settings: abbrev, bell time, faith-fit toggle, sub budget.
router.patch("/schools/:id", loadAdminSchool, async (req, res) => {
  const set = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) set.name = req.body.name.trim();
  if (typeof req.body?.abbrev === "string") set.abbrev = req.body.abbrev.trim().slice(0, 8);
  if (typeof req.body?.location === "string") set.location = req.body.location.trim();
  if (typeof req.body?.bellTime === "string" && /^\d{2}:\d{2}$/.test(req.body.bellTime)) set.bellTime = req.body.bellTime;
  if (typeof req.body?.faithFitEnabled === "boolean") set["faithFit.enabled"] = req.body.faithFitEnabled;
  if (Number.isFinite(req.body?.subBudgetTotal)) set["subBudget.total"] = req.body.subBudgetTotal;
  if (typeof req.body?.vpEmail === "string") set.vpEmail = req.body.vpEmail.trim().toLowerCase();
  if (typeof req.body?.vpName === "string") set.vpName = req.body.vpName.trim();
  if (typeof req.body?.vpPhone === "string") set.vpPhone = req.body.vpPhone.trim();
  if (typeof req.body?.financeEmail === "string") set.financeEmail = req.body.financeEmail.trim().toLowerCase();
  if (typeof req.body?.adminPhone === "string") set.adminPhone = req.body.adminPhone.trim();
  if (typeof req.body?.address === "string") set.address = req.body.address.trim();
  if (typeof req.body?.phone === "string") set.phone = req.body.phone.trim();
  if (typeof req.body?.email === "string") set.email = req.body.email.trim().toLowerCase();
  for (const k of ["morningStart", "morningEnd", "dayStart", "dayEnd"]) {
    if (typeof req.body?.[k] === "string" && (req.body[k] === "" || /^\d{2}:\d{2}$/.test(req.body[k]))) set[`hours.${k}`] = req.body[k];
  }
  if (Array.isArray(req.body?.divisions)) {
    set.divisions = req.body.divisions
      .filter((d) => d && typeof d.name === "string" && d.name.trim())
      .map((d) => ({
        name: d.name.trim(),
        vpName: String(d.vpName || "").trim(),
        vpEmail: String(d.vpEmail || "").trim().toLowerCase(),
        vpPhone: String(d.vpPhone || "").trim(),
      }));
  }
  if (["none", "sick_only", "all"].includes(req.body?.vpApproval)) set.vpApproval = req.body.vpApproval;
  if (typeof req.body?.requireSickVoiceNote === "boolean") set.requireSickVoiceNote = req.body.requireSickVoiceNote;
  await SubsSchool.updateOne({ _id: req.school._id }, { $set: set });
  const school = await SubsSchool.findById(req.school._id).lean();
  res.json({ school });
});

// Generate (or return) the reusable staff join link the principal
// broadcasts to all staff. Clicking it connects a signed-in teacher to
// this school's roster (see /api/subs-teacher/join-staff).
router.post("/schools/:id/staff-link", loadAdminSchool, async (req, res) => {
  let token = req.school.staffJoinToken;
  if (!token || req.body?.regenerate) {
    token = crypto.randomBytes(16).toString("hex");
    await SubsSchool.updateOne({ _id: req.school._id }, { $set: { staffJoinToken: token } });
  }
  res.json({ link: `${APP_BASE_URL}?staff=${token}`, token });
});

router.post("/schools/:id/admins", loadAdminSchool, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
  await SubsSchool.updateOne({ _id: req.school._id }, { $addToSet: { adminEmails: email } });
  const school = await SubsSchool.findById(req.school._id).lean();
  res.json({ school });
});

// ── Grade levels ──────────────────────────────────────────────────────

router.get("/schools/:id/grades", loadAdminSchool, async (req, res) => {
  const grades = await SubsGradeLevel.find({ schoolId: req.school._id }).sort({ order: 1, name: 1 }).lean();
  res.json({ grades });
});

router.post("/schools/:id/grades", loadAdminSchool, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Grade level name is required" });
  const count = await SubsGradeLevel.countDocuments({ schoolId: req.school._id });
  const grade = await SubsGradeLevel.create({
    schoolId: req.school._id,
    name,
    order: Number.isFinite(req.body?.order) ? req.body.order : count,
    vpEmail: typeof req.body?.vpEmail === "string" ? req.body.vpEmail.trim().toLowerCase() : "",
  });
  res.json({ grade: grade.toObject() });
});

// Set the "appropriate VP" for a grade (overrides the school default VP).
router.patch("/schools/:id/grades/:gid", loadAdminSchool, async (req, res) => {
  const { gid } = req.params;
  if (!isOid(gid)) return res.status(400).json({ error: "Bad grade id" });
  const set = {};
  if (typeof req.body?.vpEmail === "string") set.vpEmail = req.body.vpEmail.trim().toLowerCase();
  if (typeof req.body?.division === "string") set.division = req.body.division.trim();
  if (typeof req.body?.name === "string" && req.body.name.trim()) set.name = req.body.name.trim();
  await SubsGradeLevel.updateOne({ _id: gid, schoolId: req.school._id }, { $set: set });
  res.json({ ok: true });
});

// ── Substitute teacher pool ───────────────────────────────────────────

router.get("/teachers", async (req, res) => {
  const teachers = await SubsTeacher.find({}).sort({ name: 1, email: 1 }).lean();
  res.json({ teachers });
});

// Add or upsert a substitute by email. Admins curate the pool; a teacher
// can later sign in with the same email to set their own contact prefs.
router.post("/teachers", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const set = {};
  if (name) set.name = name;
  if (phone) set.phone = phone;
  const teacher = await SubsTeacher.findOneAndUpdate(
    { email },
    { $set: set, $setOnInsert: { email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ teacher });
});

// ── Preference ranking per (school, grade) ────────────────────────────

router.get("/schools/:id/grades/:gid/ranking", loadAdminSchool, async (req, res) => {
  const { gid } = req.params;
  if (!isOid(gid)) return res.status(400).json({ error: "Bad grade id" });
  const ranking = await SubsRanking.findOne({ schoolId: req.school._id, gradeLevelId: gid }).lean();
  const teacherIds = (ranking?.entries || []).sort((a, b) => a.rank - b.rank).map((e) => e.teacherId);
  res.json({ teacherIds });
});

// Replace the ranking with an ordered array of teacher ids (index = rank).
router.put("/schools/:id/grades/:gid/ranking", loadAdminSchool, async (req, res) => {
  const { gid } = req.params;
  if (!isOid(gid)) return res.status(400).json({ error: "Bad grade id" });
  const ids = Array.isArray(req.body?.teacherIds) ? req.body.teacherIds : null;
  if (!ids) return res.status(400).json({ error: "teacherIds array required" });
  if (!ids.every(isOid)) return res.status(400).json({ error: "teacherIds must be valid ids" });
  const entries = ids.map((teacherId, rank) => ({ teacherId, rank }));
  await SubsRanking.findOneAndUpdate(
    { schoolId: req.school._id, gradeLevelId: gid },
    { $set: { entries } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true, teacherIds: ids });
});

// ── Sub requests ──────────────────────────────────────────────────────

router.post("/requests", async (req, res) => {
  const { schoolId, gradeLevelId, date, urgency } = req.body || {};
  if (!isOid(schoolId) || !isOid(gradeLevelId)) return res.status(400).json({ error: "Bad school/grade id" });
  if (urgency !== "urgent" && urgency !== "advance") return res.status(400).json({ error: "urgency must be 'urgent' or 'advance'" });
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  const school = await SubsSchool.findById(schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const grade = await SubsGradeLevel.findById(gradeLevelId).lean();
  if (!grade || String(grade.schoolId) !== String(schoolId)) return res.status(400).json({ error: "Grade level not in this school" });

  // Allow an explicit override (ms) for testing/tuning; otherwise derive
  // the interval from urgency and freeze it onto the request.
  const override = Number(req.body?.escalationIntervalMs);
  const escalationIntervalMs = Number.isFinite(override) && override > 0
    ? override
    : urgency === "urgent" ? URGENT_INTERVAL_MS : ADVANCE_INTERVAL_MS;

  // Faith-fit requirements only apply when the school enables the feature.
  const faithReq = school.faithFit?.enabled && Array.isArray(req.body?.requiredFaithFit)
    ? req.body.requiredFaithFit.filter((k) => typeof k === "string")
    : [];

  // Optional lesson plan (with encrypted credentials).
  let lessonPlanId = null;
  if (req.body?.lessonPlan && typeof req.body.lessonPlan === "object") {
    try {
      const plan = await createLessonPlanDoc({ schoolId, input: req.body.lessonPlan });
      lessonPlanId = plan._id;
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  const request = await SubsRequest.create({
    schoolId,
    gradeLevelId,
    date,
    urgency,
    escalationIntervalMs,
    startTime: typeof req.body?.startTime === "string" ? req.body.startTime : "",
    dayPart: ["full", "am", "pm", "custom"].includes(req.body?.dayPart) ? req.body.dayPart : "full",
    endTime: typeof req.body?.endTime === "string" ? req.body.endTime : "",
    requiredRole: typeof req.body?.requiredRole === "string" ? req.body.requiredRole : "teacher",
    requiredQualifications: Array.isArray(req.body?.requiredQualifications)
      ? req.body.requiredQualifications.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim())
      : [],
    requiredFaithFit: faithReq,
    difficultyNote: typeof req.body?.difficultyNote === "string" ? req.body.difficultyNote.trim() : "",
    supportLevel: typeof req.body?.supportLevel === "string" ? req.body.supportLevel.trim() : "",
    lessonPlanId,
    estimatedCost: Number.isFinite(req.body?.estimatedCost) ? req.body.estimatedCost : null,
    notes: typeof req.body?.notes === "string" ? req.body.notes.trim() : "",
    createdByEmail: req.subsUser.email,
    source: "admin",
    // The absent teacher being covered (optional on admin-posted requests);
    // emailed on a fill to send lesson plans by reply-all.
    absentTeacher: req.body?.absentTeacher && typeof req.body.absentTeacher === "object"
      ? { name: String(req.body.absentTeacher.name || "").trim(), email: String(req.body.absentTeacher.email || "").trim().toLowerCase() }
      : { name: "", email: "" },
    reason: typeof req.body?.reason === "string" ? req.body.reason.trim() : "",
    status: "open",
    currentRank: -1,
  });

  // Compute how many ranked subs actually qualify, so the dashboard can
  // immediately flag "0 qualified candidates" (challenge #1).
  const eligibleCount = await getSubsEngine().countEligible(request.toObject());
  await SubsRequest.updateOne({ _id: request._id }, { $set: { eligibleCountAtPost: eligibleCount } });

  // Remember these requirements for the absent teacher's class so the next
  // request for them pre-fills.
  await rememberStaffDefaults(request.schoolId, request.absentTeacher?.email, request.requiredRole, request.requiredQualifications);

  // Kick off the first offer immediately (don't wait for the next sweep).
  getSubsEngine()
    .onRequestCreated(request._id)
    .catch((err) => console.error("[subs] onRequestCreated error:", err?.message || err));

  res.json({ request: { ...request.toObject(), eligibleCountAtPost: eligibleCount }, eligibleCount });
});

// Requests for a school, each enriched with its offers + teacher names so
// the admin can watch the escalation walk down the ranking live.
router.get("/schools/:id/requests", loadAdminSchool, async (req, res) => {
  const requests = await SubsRequest.find({ schoolId: req.school._id }).sort({ createdAt: -1 }).limit(100).lean();
  const grades = await SubsGradeLevel.find({ schoolId: req.school._id }).lean();
  const gradeName = new Map(grades.map((g) => [String(g._id), g.name]));

  const reqIds = requests.map((r) => r._id);
  const offers = await SubsOffer.find({ requestId: { $in: reqIds } }).sort({ createdAt: 1 }).lean();
  const teacherIds = [...new Set(offers.map((o) => String(o.teacherId)))];
  const teachers = await SubsTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = new Map(teachers.map((t) => [String(t._id), t]));

  const offersByReq = new Map();
  for (const o of offers) {
    const arr = offersByReq.get(String(o.requestId)) || [];
    const t = teacherById.get(String(o.teacherId));
    arr.push({
      _id: o._id,
      rank: o.rank,
      status: o.status,
      sentAt: o.sentAt,
      expiresAt: o.expiresAt,
      respondedAt: o.respondedAt,
      channels: o.channels,
      teacherName: t?.name || t?.email || "Unknown",
      // So the principal can call the sub directly if they want to.
      teacherPhone: t?.phone || "",
      teacherEmail: t?.email || "",
    });
    offersByReq.set(String(o.requestId), arr);
  }

  res.json({
    requests: requests.map((r) => ({
      ...r,
      gradeName: gradeName.get(String(r.gradeLevelId)) || "—",
      offers: offersByReq.get(String(r._id)) || [],
    })),
  });
});

router.post("/requests/:rid/cancel", async (req, res) => {
  const { rid } = req.params;
  if (!isOid(rid)) return res.status(400).json({ error: "Bad request id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request) return res.status(404).json({ error: "Request not found" });
  const school = await SubsSchool.findById(request.schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  if (request.status !== "open") return res.status(400).json({ error: `Request is already ${request.status}` });
  await SubsRequest.updateOne({ _id: rid }, { $set: { status: "cancelled" } });
  await SubsOffer.updateMany({ requestId: rid, status: "pending" }, { $set: { status: "expired", respondedAt: new Date() } });
  res.json({ ok: true });
});

// ── Morning triage dashboard (challenge #2) ───────────────────────────
// Everything a principal needs at 6 a.m.: today's open absences across all
// their schools, sorted by urgency then time-to-bell, with live qualified-
// candidate counts and fill status — plus what's already covered, and an
// internal-coverage load tally to watch for burnout (challenge #8).
function needByISO(request, school) {
  // PM half-days start at the school's afternoon start (morningEnd); else
  // the request's own start; else the school's day start / bell time.
  const t =
    (request.dayPart === "pm" && school?.hours?.morningEnd) ||
    request.startTime ||
    school?.hours?.dayStart ||
    school?.bellTime ||
    "08:30";
  // Interpret as a naive local datetime string; the frontend renders the
  // countdown in the viewer's locale.
  return `${request.date}T${t.length === 5 ? t : "08:30"}:00`;
}

router.get("/dashboard", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const schools = await SubsSchool.find({ adminEmails: req.subsUser.email }).lean();
  const schoolById = new Map(schools.map((s) => [String(s._id), s]));
  const schoolIds = schools.map((s) => s._id);

  const grades = await SubsGradeLevel.find({ schoolId: { $in: schoolIds } }).lean();
  const gradeName = new Map(grades.map((g) => [String(g._id), g.name]));

  const open = await SubsRequest.find({ schoolId: { $in: schoolIds }, status: "open" }).lean();
  const coveredToday = await SubsRequest.find({ schoolId: { $in: schoolIds }, status: "filled", date: today }).lean();

  const engine = getSubsEngine();
  const openEnriched = await Promise.all(
    open.map(async (r) => {
      const school = schoolById.get(String(r.schoolId));
      const eligibleCount = await engine.countEligible(r);
      const pending = await SubsOffer.findOne({ requestId: r._id, status: "pending" }).lean();
      return {
        ...r,
        schoolName: school?.name,
        schoolAbbrev: school?.abbrev,
        gradeName: gradeName.get(String(r.gradeLevelId)) || "—",
        eligibleCount,
        needBy: needByISO(r, school),
        pendingOfferExpiresAt: pending?.expiresAt || null,
      };
    })
  );
  // Urgent first, then soonest needed.
  openEnriched.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    return new Date(a.needBy) - new Date(b.needBy);
  });

  // Internal-coverage load per staff member (burnout signal).
  const coverage = await SubsInternalCoverage.find({ schoolId: { $in: schoolIds } }).lean();
  const loadMap = new Map();
  for (const c of coverage) {
    const key = c.staffEmail || c.staffName;
    loadMap.set(key, { staffName: c.staffName, count: (loadMap.get(key)?.count || 0) + 1 });
  }
  const burnout = [...loadMap.values()].sort((a, b) => b.count - a.count);

  res.json({
    schools: schools.map((s) => ({ _id: s._id, name: s.name, abbrev: s.abbrev })),
    open: openEnriched,
    coveredToday: coveredToday.map((r) => ({
      _id: r._id,
      gradeName: gradeName.get(String(r.gradeLevelId)) || "—",
      schoolName: schoolById.get(String(r.schoolId))?.name,
      coverageType: r.coverageType,
    })),
    burnout,
  });
});

// ── Multi-school sub invite (registration) ────────────────────────────
// Admin enters a sub's email; we attach them to this school and send a
// sign-in link. When they click it, the app lists every school they're
// registered with (see /api/subs-teacher/accept-invite).
router.post("/schools/:id/invite", loadAdminSchool, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";

  const set = {};
  if (name) set.name = name;
  if (phone) set.phone = phone;
  const teacher = await SubsTeacher.findOneAndUpdate(
    { email },
    { $set: set, $setOnInsert: { email }, $addToSet: { schoolIds: req.school._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  const token = crypto.randomBytes(20).toString("hex");
  await SubsInvite.create({ email, schoolId: req.school._id, token, invitedByEmail: req.subsUser.email });
  const inviteLink = `${APP_BASE_URL}?invite=${token}`;

  // Notify the sub (email always; SMS too if we have a number). Best-effort.
  try {
    await notifier.notifyInvite({ email, phone, school: req.school, inviteLink });
  } catch (e) {
    console.error("[subs] invite notify error:", e?.message || e);
  }

  res.json({ ok: true, teacher, inviteLink });
});

// ── Internal-coverage fallback (challenge #8) ─────────────────────────
router.post("/requests/:rid/internal-coverage", async (req, res) => {
  const { rid } = req.params;
  if (!isOid(rid)) return res.status(400).json({ error: "Bad request id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request) return res.status(404).json({ error: "Request not found" });
  const school = await SubsSchool.findById(request.schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const type = req.body?.type;
  const staffName = typeof req.body?.staffName === "string" ? req.body.staffName.trim() : "";
  if (!COVERAGE_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${COVERAGE_TYPES.join(", ")}` });
  if (!staffName) return res.status(400).json({ error: "staffName is required" });

  const cov = await SubsInternalCoverage.create({
    schoolId: request.schoolId,
    requestId: rid,
    type,
    staffName,
    staffEmail: typeof req.body?.staffEmail === "string" ? req.body.staffEmail.trim().toLowerCase() : "",
    note: typeof req.body?.note === "string" ? req.body.note.trim() : "",
    createdByEmail: req.subsUser.email,
  });
  const result = await getSubsEngine().assignInternalCoverage(request, { internalCoverageId: cov._id });
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ ok: true });
});

// ── Reliability / quality feedback (challenges #9, #10) ───────────────
router.post("/feedback", async (req, res) => {
  const { teacherId, schoolId, requestId } = req.body || {};
  if (!isOid(teacherId) || !isOid(schoolId)) return res.status(400).json({ error: "Bad teacher/school id" });
  const school = await SubsSchool.findById(schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const rating = Number(req.body?.rating);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: "rating must be 1–5" });

  await SubsReliabilityFeedback.create({
    teacherId,
    schoolId,
    requestId: isOid(requestId) ? requestId : null,
    rating,
    onTime: typeof req.body?.onTime === "boolean" ? req.body.onTime : null,
    canTeach: typeof req.body?.canTeach === "boolean" ? req.body.canTeach : null,
    tags: Array.isArray(req.body?.tags) ? req.body.tags.filter((t) => typeof t === "string") : [],
    note: typeof req.body?.note === "string" ? req.body.note.trim() : "",
    createdByEmail: req.subsUser.email,
  });

  // Recompute the sub's aggregate rating + merge tags (informs ranking).
  const all = await SubsReliabilityFeedback.find({ teacherId }).lean();
  const avg = all.reduce((s, f) => s + f.rating, 0) / all.length;
  const onTimeVals = all.filter((f) => typeof f.onTime === "boolean");
  const onTimeRate = onTimeVals.length ? onTimeVals.filter((f) => f.onTime).length / onTimeVals.length : null;
  const tags = [...new Set(all.flatMap((f) => f.tags || []))];
  await SubsTeacher.updateOne(
    { _id: teacherId },
    { $set: { "reliability.adminRating": Math.round(avg * 10) / 10, "reliability.ratingCount": all.length, "reliability.onTimeRate": onTimeRate, "reliability.tags": tags } }
  );
  res.json({ ok: true });
});

// ── Why does nobody qualify? (challenge #1 diagnostics) ───────────────
router.get("/requests/:rid/candidates", async (req, res) => {
  const { rid } = req.params;
  if (!isOid(rid)) return res.status(400).json({ error: "Bad request id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request) return res.status(404).json({ error: "Request not found" });
  const school = await SubsSchool.findById(request.schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const ranking = await SubsRanking.findOne({ schoolId: request.schoolId, gradeLevelId: request.gradeLevelId }).lean();
  const ids = (ranking?.entries || []).sort((a, b) => a.rank - b.rank).map((e) => e.teacherId);
  const teachers = await SubsTeacher.find({ _id: { $in: ids } }).lean();
  const byId = new Map(teachers.map((t) => [String(t._id), t]));
  const candidates = ids.map((id) => {
    const t = byId.get(String(id));
    return {
      teacherId: id,
      name: t?.name || t?.email,
      eligible: t ? isEligible(t, request) : false,
      reasons: t ? eligibilityReasons(t, request) : ["not found"],
    };
  });
  res.json({ candidates, eligibleCount: candidates.filter((c) => c.eligible).length });
});

// ── Preview / dry-run: who would be contacted, in order, and how often ─
// Computes the contact plan for a hypothetical request WITHOUT creating
// anything — so the principal can see "teacher X is out → these subs, in
// this order, at N-minute intervals" before posting.
router.post("/preview", async (req, res) => {
  const { schoolId, gradeLevelId } = req.body || {};
  if (!isOid(schoolId) || !isOid(gradeLevelId)) return res.status(400).json({ error: "Pick a school and grade" });
  const school = await SubsSchool.findById(schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const urgency = req.body?.urgency === "advance" ? "advance" : "urgent";
  const override = Number(req.body?.escalationIntervalMs);
  const intervalMs = Number.isFinite(override) && override > 0 ? override : urgency === "urgent" ? URGENT_INTERVAL_MS : ADVANCE_INTERVAL_MS;
  const pseudo = {
    requiredRole: typeof req.body?.requiredRole === "string" ? req.body.requiredRole : "teacher",
    requiredQualifications: Array.isArray(req.body?.requiredQualifications) ? req.body.requiredQualifications.filter((q) => typeof q === "string") : [],
    requiredFaithFit: school.faithFit?.enabled && Array.isArray(req.body?.requiredFaithFit) ? req.body.requiredFaithFit : [],
  };

  const ranking = await SubsRanking.findOne({ schoolId, gradeLevelId }).lean();
  const sorted = (ranking?.entries || []).slice().sort((a, b) => a.rank - b.rank);
  const teachers = await SubsTeacher.find({ _id: { $in: sorted.map((e) => e.teacherId) } }).lean();
  const byId = new Map(teachers.map((t) => [String(t._id), t]));

  const intervalMin = Math.round(intervalMs / 60000);
  const order = [];
  let skipped = 0;
  for (const e of sorted) {
    const t = byId.get(String(e.teacherId));
    if (!t) continue;
    if (isEligible(t, pseudo)) {
      order.push({
        position: order.length + 1,
        afterMinutes: order.length * intervalMin,
        name: t.name || t.email,
        phone: t.phone || "",
        email: t.email || "",
        contactPrefs: t.contactPrefs || { email: true },
      });
    } else {
      skipped += 1;
    }
  }
  res.json({ urgency, intervalMinutes: intervalMin, order, skipped, qualifiedCount: order.length });
});

// ── Smart match (AI-assisted suggestions for hard-to-fill requests) ───
// Advisory only — suggests the closest subs (incl. near-misses the exact
// filter excludes), each with a reason and fit score.
router.post("/requests/:rid/smart-match", async (req, res) => {
  const { rid } = req.params;
  if (!isOid(rid)) return res.status(400).json({ error: "Bad request id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request) return res.status(404).json({ error: "Request not found" });
  const school = await SubsSchool.findById(request.schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const ranking = await SubsRanking.findOne({ schoolId: request.schoolId, gradeLevelId: request.gradeLevelId }).lean();
  const ids = (ranking?.entries || []).map((e) => e.teacherId);
  const candidates = ids.length ? await SubsTeacher.find({ _id: { $in: ids }, active: { $ne: false } }).lean() : [];
  const grade = await SubsGradeLevel.findById(request.gradeLevelId).lean();
  const suggestions = await smartMatch({ request, gradeName: grade?.name, candidates });
  res.json({ suggestions });
});

// Override-offer: contact a specific sub even if the filter excluded them
// (acting on a smart-match suggestion).
router.post("/requests/:rid/offer/:teacherId", async (req, res) => {
  const { rid, teacherId } = req.params;
  if (!isOid(rid) || !isOid(teacherId)) return res.status(400).json({ error: "Bad id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request) return res.status(404).json({ error: "Request not found" });
  const school = await SubsSchool.findById(request.schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  const result = await getSubsEngine().offerSpecific(rid, teacherId);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ ok: true });
});

// ── Lesson plan (admin view — decrypts credentials for the owner) ─────
router.get("/requests/:rid/lesson-plan", async (req, res) => {
  const { rid } = req.params;
  if (!isOid(rid)) return res.status(400).json({ error: "Bad request id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request) return res.status(404).json({ error: "Request not found" });
  const school = await SubsSchool.findById(request.schoolId).lean();
  if (!school || !(school.adminEmails || []).includes(req.subsUser.email)) {
    return res.status(403).json({ error: "Not an admin of this school" });
  }
  if (!request.lessonPlanId) return res.json({ plan: null });
  const plan = await SubsLessonPlan.findById(request.lessonPlanId).lean();
  res.json({ plan: plan ? decoratePlan(plan, true) : null });
});

// Shape a plan for the client; reveal decrypted secrets only when allowed.
export function decoratePlan(plan, reveal) {
  return {
    _id: plan._id,
    body: plan.body,
    routineNotes: plan.routineNotes,
    materialsLinks: plan.materialsLinks,
    completeness: plan.completeness,
    credentials: (plan.credentials || []).map((c) => ({
      system: c.system,
      username: c.username,
      hasSecret: !!c.secretEnc,
      secret: reveal && c.secretEnc ? safeDecrypt(c.secretEnc) : undefined,
    })),
  };
}
function safeDecrypt(enc) {
  try {
    return decryptSecret(enc);
  } catch {
    return undefined; // never throw to the client; never log the value
  }
}

// ── Teacher-initiated requests: approval workflow ─────────────────────
// Build the caller's approver relationships across schools: where they're
// an admin, the school's default VP, or a specific grade's VP.
async function approverContext(email) {
  const [adminSchools, vpDefaultSchools, divisionSchools, vpGrades] = await Promise.all([
    SubsSchool.find({ adminEmails: email }).lean(),
    SubsSchool.find({ vpEmail: email }).lean(), // school-wide VP (all grades)
    SubsSchool.find({ "divisions.vpEmail": email }).lean(), // VP of a division
    SubsGradeLevel.find({ vpEmail: email }).lean(), // per-grade override
  ]);
  const vpGradeSet = new Set(vpGrades.map((g) => String(g._id)));
  // Grades covered because this email is the VP of their division.
  if (divisionSchools.length) {
    const divNamesBySchool = new Map(
      divisionSchools.map((s) => [String(s._id), new Set((s.divisions || []).filter((d) => d.vpEmail === email).map((d) => d.name))])
    );
    const grades = await SubsGradeLevel.find({ schoolId: { $in: divisionSchools.map((s) => s._id) } }).lean();
    for (const g of grades) {
      const names = divNamesBySchool.get(String(g.schoolId));
      if (names && g.division && names.has(g.division)) vpGradeSet.add(String(g._id));
    }
  }
  return {
    adminSet: new Set(adminSchools.map((s) => String(s._id))),
    vpSchoolSet: new Set(vpDefaultSchools.map((s) => String(s._id))),
    vpGradeSet,
    schoolIds: [
      ...new Set([
        ...adminSchools.map((s) => String(s._id)),
        ...vpDefaultSchools.map((s) => String(s._id)),
        ...divisionSchools.map((s) => String(s._id)),
        ...vpGrades.map((g) => String(g.schoolId)),
      ]),
    ],
  };
}

function isSickReason(reason) {
  return /sick/i.test(reason || "");
}

// Visibility: can this person see the request in their queue at all?
function approverSees(request, ctx) {
  const sid = String(request.schoolId);
  return ctx.adminSet.has(sid) || ctx.vpSchoolSet.has(sid) || ctx.vpGradeSet.has(String(request.gradeLevelId));
}

// Authority: may this person actually approve/deny it? Admins always; VPs
// per the school's vpApproval policy (and grade scope).
function approverCan(request, school, ctx) {
  const sid = String(request.schoolId);
  if (ctx.adminSet.has(sid)) return true;
  const isVpScope = ctx.vpSchoolSet.has(sid) || ctx.vpGradeSet.has(String(request.gradeLevelId));
  if (!isVpScope) return false;
  const policy = school?.vpApproval || "none";
  if (policy === "all") return true;
  if (policy === "sick_only") return isSickReason(request.reason);
  return false;
}

// Load a request for an approve/deny action and confirm the caller has
// authority over it (admin or permitted VP).
async function loadApprovableRequest(req, res) {
  const { rid } = req.params;
  if (!isOid(rid)) {
    res.status(400).json({ error: "Bad request id" });
    return null;
  }
  const request = await SubsRequest.findById(rid).lean();
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return null;
  }
  const school = await SubsSchool.findById(request.schoolId).lean();
  const ctx = await approverContext(req.subsUser.email);
  if (!approverCan(request, school, ctx)) {
    res.status(403).json({ error: "You're not allowed to approve this absence" });
    return null;
  }
  return { request, school };
}

// Pending teacher-submitted requests the caller can see (as admin or VP),
// each annotated with whether they're actually allowed to approve it.
router.get("/approvals", async (req, res) => {
  const ctx = await approverContext(req.subsUser.email);
  if (ctx.schoolIds.length === 0) return res.json({ approvals: [] });
  const schools = await SubsSchool.find({ _id: { $in: ctx.schoolIds } }).select("name abbrev vpApproval").lean();
  const schoolById = new Map(schools.map((s) => [String(s._id), s]));
  const pending = await SubsRequest.find({ schoolId: { $in: ctx.schoolIds }, status: "pending_approval" }).sort({ createdAt: 1 }).lean();
  const grades = await SubsGradeLevel.find({ _id: { $in: pending.map((r) => r.gradeLevelId) } }).select("name").lean();
  const gradeName = new Map(grades.map((g) => [String(g._id), g.name]));
  res.json({
    approvals: pending
      .filter((r) => approverSees(r, ctx))
      .map((r) => ({
        ...r,
        schoolName: schoolById.get(String(r.schoolId))?.name || "—",
        gradeName: gradeName.get(String(r.gradeLevelId)) || "—",
        canApprove: approverCan(r, schoolById.get(String(r.schoolId)), ctx),
        hasVoiceNote: !!r.voiceNoteId,
        voiceNoteStatus: r.voiceNoteStatus || "none",
      })),
  });
});

// Play a sick-day voice note — for any approver who can see the request
// (admins of the school, or VPs scoped to it). Returns a data URL.
router.get("/requests/:rid/voice-note", async (req, res) => {
  const { rid } = req.params;
  if (!isOid(rid)) return res.status(400).json({ error: "Bad request id" });
  const request = await SubsRequest.findById(rid).lean();
  if (!request || !request.voiceNoteId) return res.status(404).json({ error: "No voice note" });
  const ctx = await approverContext(req.subsUser.email);
  if (!approverSees(request, ctx)) return res.status(403).json({ error: "Not allowed" });
  const note = await SubsVoiceNote.findById(request.voiceNoteId).lean();
  if (!note) return res.status(404).json({ error: "No voice note" });
  res.json({ dataUrl: `data:${note.mimeType};base64,${note.dataB64}`, durationSec: note.durationSec });
});

// Approve a teacher's absence request: set matching requirements, open it,
// auto-roster the teacher, fire the engine, and tell the teacher.
router.post("/requests/:rid/approve", async (req, res) => {
  const loaded = await loadApprovableRequest(req, res);
  if (!loaded) return;
  const { request, school } = loaded;
  if (request.status !== "pending_approval") return res.status(400).json({ error: `Request is ${request.status}, not awaiting approval` });

  const urgency = req.body?.urgency === "advance" || req.body?.urgency === "urgent" ? req.body.urgency : request.urgency;
  const override = Number(req.body?.escalationIntervalMs);
  const escalationIntervalMs = Number.isFinite(override) && override > 0 ? override : urgency === "urgent" ? URGENT_INTERVAL_MS : ADVANCE_INTERVAL_MS;
  const faithReq = school.faithFit?.enabled && Array.isArray(req.body?.requiredFaithFit) ? req.body.requiredFaithFit.filter((k) => typeof k === "string") : [];

  const set = {
    status: "open",
    approvedByEmail: req.subsUser.email,
    approvedAt: new Date(),
    urgency,
    escalationIntervalMs,
    requiredRole: typeof req.body?.requiredRole === "string" ? req.body.requiredRole : "teacher",
    requiredQualifications: Array.isArray(req.body?.requiredQualifications) ? req.body.requiredQualifications.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim()) : [],
    requiredFaithFit: faithReq,
  };
  await SubsRequest.updateOne({ _id: request._id }, { $set: set });

  // Auto-roster the requesting teacher + remember the chosen requirements.
  if (request.absentTeacher?.email) {
    await SubsStaff.findOneAndUpdate(
      { schoolId: request.schoolId, email: request.absentTeacher.email },
      {
        $set: {
          name: request.absentTeacher.name || "",
          gradeLevelId: request.gradeLevelId,
          viaApproval: true,
          defaultRole: set.requiredRole,
          defaultRequiredQualifications: set.requiredQualifications,
        },
        $setOnInsert: { schoolId: request.schoolId, email: request.absentTeacher.email },
      },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch((e) => console.error("[subs] auto-roster error:", e?.message || e));
  }

  const updated = await SubsRequest.findById(request._id).lean();
  const eligibleCount = await getSubsEngine().countEligible(updated);
  await SubsRequest.updateOne({ _id: request._id }, { $set: { eligibleCountAtPost: eligibleCount } });

  getSubsEngine().onRequestCreated(request._id).catch((err) => console.error("[subs] approve onRequestCreated:", err?.message || err));

  const grade = await SubsGradeLevel.findById(request.gradeLevelId).lean();
  notifier.notifyRequestDecision({ request: updated, school, gradeLevel: grade, absentTeacher: request.absentTeacher, approved: true }).catch(() => {});

  res.json({ ok: true, eligibleCount });
});

router.post("/requests/:rid/deny", async (req, res) => {
  const loaded = await loadApprovableRequest(req, res);
  if (!loaded) return;
  const { request, school } = loaded;
  if (request.status !== "pending_approval") return res.status(400).json({ error: `Request is ${request.status}, not awaiting approval` });
  const denyReason = typeof req.body?.denyReason === "string" ? req.body.denyReason.trim() : "";
  await SubsRequest.updateOne({ _id: request._id }, { $set: { status: "denied", denyReason, approvedByEmail: req.subsUser.email, approvedAt: new Date() } });
  const grade = await SubsGradeLevel.findById(request.gradeLevelId).lean();
  notifier.notifyRequestDecision({ request, school, gradeLevel: grade, absentTeacher: request.absentTeacher, approved: false, denyReason }).catch(() => {});
  res.json({ ok: true });
});

// ── Staff roster (the auto-building teacher list) ─────────────────────
router.get("/schools/:id/staff", loadAdminSchool, async (req, res) => {
  const staff = await SubsStaff.find({ schoolId: req.school._id }).sort({ name: 1, email: 1 }).lean();
  res.json({ staff });
});

router.post("/schools/:id/staff", loadAdminSchool, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
  const set = {};
  if (typeof req.body?.name === "string") set.name = req.body.name.trim();
  if (isOid(req.body?.gradeLevelId)) set.gradeLevelId = req.body.gradeLevelId;
  const staff = await SubsStaff.findOneAndUpdate(
    { schoolId: req.school._id, email },
    { $set: set, $setOnInsert: { schoolId: req.school._id, email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ staff });
});

// ── Absence reporting (per staff) ─────────────────────────────────────
// An "absence" = a request that actually represents the teacher being away
// (not denied/cancelled). Grouped per staff member with a reason breakdown.
async function buildAbsenceReport(schoolId, from, to) {
  const q = { schoolId, status: { $nin: ["denied", "cancelled"] } };
  if (from || to) q.date = {};
  if (from) q.date.$gte = from;
  if (to) q.date.$lte = to;
  const reqs = await SubsRequest.find(q).sort({ date: 1 }).lean();
  const byEmail = new Map();
  for (const r of reqs) {
    const email = r.absentTeacher?.email || r.requestedByEmail || "(unspecified)";
    const name = r.absentTeacher?.name || "";
    const row = byEmail.get(email) || { email, name, total: 0, byReason: {}, dates: [] };
    if (name && !row.name) row.name = name;
    row.total += 1;
    const reason = r.reason || "Unspecified";
    row.byReason[reason] = (row.byReason[reason] || 0) + 1;
    row.dates.push({ date: r.date, reason, status: r.status });
    byEmail.set(email, row);
  }
  return [...byEmail.values()].sort((a, b) => b.total - a.total);
}

router.get("/schools/:id/absence-report", loadAdminSchool, async (req, res) => {
  const rows = await buildAbsenceReport(req.school._id, req.query.from, req.query.to);
  res.json({ school: { _id: req.school._id, name: req.school.name }, from: req.query.from || null, to: req.query.to || null, rows });
});

// Email the report on demand (defaults to the requesting principal).
router.post("/schools/:id/absence-report/email", loadAdminSchool, async (req, res) => {
  const rows = await buildAbsenceReport(req.school._id, req.body?.from, req.body?.to);
  const to = typeof req.body?.to === "string" && isValidEmail(req.body.to) ? req.body.to.toLowerCase() : req.subsUser.email;
  const period = req.body?.from || req.body?.to ? ` (${req.body?.from || "…"} → ${req.body?.to || "…"})` : "";
  const lines = [`Absence report — ${req.school.name}${period}`, ""];
  for (const r of rows) {
    const reasons = Object.entries(r.byReason).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`${r.name || r.email} — ${r.total} absence(s) [${reasons}]`);
  }
  if (rows.length === 0) lines.push("No absences in this period.");
  try {
    await notifier.sendAbsenceReport({ to, schoolName: req.school.name, text: lines.join("\n") });
  } catch (e) {
    return res.status(502).json({ error: `Could not send report: ${e.message}` });
  }
  res.json({ ok: true, sentTo: to, staffCount: rows.length });
});

// Dev/diagnostic: force one escalation sweep right now instead of waiting
// for the timer. Useful for demoing the full happy path quickly.
router.post("/dev/tick", async (req, res) => {
  const summary = await tickNow();
  res.json({ ok: true, ...summary });
});

export default router;
