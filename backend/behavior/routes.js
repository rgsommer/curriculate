// backend/behavior/routes.js
//
// Behaviours API (brief §6, §3, §5d, §7). Mounted at /api/behavior in index.js.
// Reuses the existing JWT auth (authAny) — every route is behind it. School
// membership + role are loaded from BehaviorTeacher.
//
// The append-only incident model + cross-teacher aggregation live in
// ./lib/triggerLogic.js; delivery + failover in ./lib/notify.js; the AI note in
// ./lib/aiNote.js. This file is the orchestration glue.

import express from "express";
import crypto from "crypto";
import multer from "multer";

import authAny from "../middleware/authAny.js";
import { mailer } from "../email/mailer.js";

import BehaviorSchool from "./models/BehaviorSchool.js";
import BehaviorTeacher from "./models/BehaviorTeacher.js";
import BehaviorInvite from "./models/BehaviorInvite.js";
import BehaviorStudent from "./models/BehaviorStudent.js";
import Behavior from "./models/Behavior.js";
import BehaviorIncident from "./models/BehaviorIncident.js";
import BehaviorNotice from "./models/BehaviorNotice.js";
import BehaviorConfig from "./models/BehaviorConfig.js";
import BehaviorAuditLog from "./models/BehaviorAuditLog.js";

import { evaluateIncident } from "./lib/triggerLogic.js";
import { seedBehaviorDocs } from "./lib/seedBehaviors.js";
import { parseRoster, parseRosterFile } from "./lib/rosterImport.js";
import { composeNotice, makeDefaultAiClient } from "./lib/aiNote.js";
import { scheduleDispatch } from "./lib/notify.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

function emailDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  return at === -1 ? "" : String(email).slice(at + 1).toLowerCase().trim();
}

function appBase() {
  return (process.env.APP_BASE_URL || "https://www.curriculate.net").replace(/\/+$/, "");
}

/** Load the caller's school membership; 404 if they have none yet. */
async function loadMembership(req, res, next) {
  try {
    const membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (!membership) {
      return res.status(404).json({ ok: false, error: "No Behaviours school for this account", needsSetup: true });
    }
    req.membership = membership;
    req.schoolId = membership.schoolId;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  const role = req.membership?.role;
  if (role !== "originator" && role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

function canLog(req, res, next) {
  const role = req.membership?.role;
  if (role === "principal") {
    return res.status(403).json({ ok: false, error: "Principal role is read-only" });
  }
  next();
}

async function audit(schoolId, type, req, extra = {}) {
  try {
    await BehaviorAuditLog.create({
      schoolId,
      type,
      actorUserId: req?.userId || null,
      actorEmail: req?.user?.email || "",
      ...extra,
    });
  } catch (err) {
    console.warn("[behavior] audit write failed:", err?.message || err);
  }
}

// ── Identity / setup ─────────────────────────────────────────────────────────

// Who am I in the Behaviours app (membership + role + config summary).
router.get("/me", authAny, async (req, res, next) => {
  try {
    const membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (!membership) return res.json({ ok: true, membership: null, needsSetup: true });
    const school = await BehaviorSchool.findById(membership.schoolId).lean();
    const config = await BehaviorConfig.findOne({ schoolId: membership.schoolId }).lean();
    res.json({ ok: true, membership, school, config });
  } catch (err) {
    next(err);
  }
});

// Originator creates the school + seeds config + standard behaviours (§5).
router.post("/setup", authAny, async (req, res, next) => {
  try {
    const existing = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (existing) return res.status(409).json({ ok: false, error: "Account already belongs to a Behaviours school" });

    const schoolName = String(req.body?.schoolName || "").trim();
    if (!schoolName) return res.status(400).json({ ok: false, error: "schoolName required" });

    const domain = emailDomain(req.user?.email);
    if (!domain) return res.status(400).json({ ok: false, error: "Could not determine your email domain" });

    const school = await BehaviorSchool.create({
      name: schoolName,
      originatorUserId: req.userId,
      emailDomain: domain,
    });

    await BehaviorConfig.create({
      schoolId: school._id,
      branding: { schoolName },
    });

    await BehaviorTeacher.create({
      schoolId: school._id,
      userId: req.userId,
      email: String(req.user.email).toLowerCase(),
      name: req.user.name || "",
      role: "originator",
      status: "accepted",
    });

    await Behavior.insertMany(seedBehaviorDocs(school._id));
    await audit(school._id, "school.created", req, { meta: { schoolName, domain } });

    res.json({ ok: true, schoolId: school._id });
  } catch (err) {
    next(err);
  }
});

// ── Config (§5b/§5c) ─────────────────────────────────────────────────────────

router.get("/config", authAny, loadMembership, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    res.json({ ok: true, config });
  } catch (err) {
    next(err);
  }
});

router.put("/config", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      "triggerCount", "fadeWindowDays", "vp", "branding", "channels",
      "aiSendMode", "cancelWindowSeconds", "aiProvider", "aiModel",
      "noticesResetMode", "termStartDates", "repeatScopeDays",
    ];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    const config = await BehaviorConfig.findOneAndUpdate(
      { schoolId: req.schoolId },
      { $set: update },
      { new: true }
    ).lean();
    await audit(req.schoolId, "config.updated", req, { meta: { fields: Object.keys(update) } });
    res.json({ ok: true, config });
  } catch (err) {
    next(err);
  }
});

// ── Invites (§5d) ────────────────────────────────────────────────────────────

router.post("/invite", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const role = ["admin", "teacher", "principal"].includes(req.body?.role) ? req.body.role : "teacher";
    // Only the originator may grant admin.
    if (role === "admin" && req.membership.role !== "originator") {
      return res.status(403).json({ ok: false, error: "Only the originator can grant admin" });
    }
    const school = await BehaviorSchool.findById(req.schoolId).lean();
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length) return res.status(400).json({ ok: false, error: "No email addresses provided" });

    const created = [];
    const rejected = [];
    for (const email of emails) {
      // Domain restriction (§5d): must match the school's domain.
      if (emailDomain(email) !== school.emailDomain) {
        rejected.push({ email, reason: `outside school domain @${school.emailDomain}` });
        continue;
      }
      const token = crypto.randomBytes(24).toString("hex");
      await BehaviorInvite.findOneAndUpdate(
        { schoolId: req.schoolId, email },
        { $set: { token, role, status: "pending", invitedByEmail: req.user.email } },
        { upsert: true, new: true }
      );
      const link = `${appBase()}/behavior/accept?token=${token}`;
      try {
        await mailer.sendMail({
          from: process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: `You're invited to ${school.name} on Behaviours`,
          text: `You have been invited to join ${school.name} on the Behaviours app.\n\nAccept your invitation and set your password:\n${link}\n`,
        });
      } catch (mailErr) {
        console.warn("[behavior] invite email failed:", mailErr?.message || mailErr);
      }
      created.push({ email, role });
    }
    await audit(req.schoolId, "invite.sent", req, { meta: { created, rejected } });
    res.json({ ok: true, invited: created, rejected });
  } catch (err) {
    next(err);
  }
});

router.get("/invites", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const invites = await BehaviorInvite.find({ schoolId: req.schoolId }).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, invites });
  } catch (err) {
    next(err);
  }
});

// Accept an invite: the signed-in user (who set a password via the existing
// signup flow) becomes a member. Their email must match the invite.
router.post("/invite/accept", authAny, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "token required" });
    const invite = await BehaviorInvite.findOne({ token, status: "pending" });
    if (!invite) return res.status(404).json({ ok: false, error: "Invite not found or already used" });

    const myEmail = String(req.user?.email || "").toLowerCase();
    if (myEmail !== invite.email) {
      return res.status(403).json({ ok: false, error: "Signed-in email does not match the invite" });
    }

    await BehaviorTeacher.findOneAndUpdate(
      { schoolId: invite.schoolId, userId: req.userId },
      {
        $set: {
          email: myEmail,
          name: req.user.name || "",
          role: invite.role,
          status: "accepted",
        },
      },
      { upsert: true, new: true }
    );
    invite.status = "accepted";
    await invite.save();
    await audit(invite.schoolId, "invite.accepted", req, { meta: { email: myEmail, role: invite.role } });
    res.json({ ok: true, schoolId: invite.schoolId });
  } catch (err) {
    next(err);
  }
});

router.post("/invite/:id/revoke", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    await BehaviorInvite.updateOne(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: "revoked" } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Roster import (§3) ───────────────────────────────────────────────────────

router.post("/roster/import", authAny, loadMembership, requireAdmin, upload.single("file"), async (req, res, next) => {
  try {
    // Accept either an uploaded file (CSV or XLSX) or raw CSV text in the body.
    let parsed;
    if (req.file) {
      parsed = await parseRosterFile(req.file.buffer, req.file.originalname || "");
    } else if (req.body?.csv) {
      parsed = parseRoster(String(req.body.csv));
    } else {
      return res.status(400).json({ ok: false, error: "No file or CSV provided" });
    }
    const { students, skipped, headerMap } = parsed;

    let imported = 0;
    let updated = 0;
    for (const s of students) {
      // Match an existing student on externalId (preferred) or full name.
      const match = s.externalId
        ? { schoolId: req.schoolId, externalId: s.externalId }
        : { schoolId: req.schoolId, lastName: s.lastName, firstName: s.firstName };
      const existing = s.externalId || (s.lastName && s.firstName)
        ? await BehaviorStudent.findOne(match)
        : null;

      if (existing) {
        Object.assign(existing, s, { schoolId: req.schoolId, active: true });
        await existing.save();
        updated += 1;
      } else {
        await BehaviorStudent.create({ ...s, schoolId: req.schoolId });
        imported += 1;
      }
    }

    await audit(req.schoolId, "roster.imported", req, {
      meta: { imported, updated, skippedCount: skipped.length, headerMap },
    });
    res.json({ ok: true, imported, updated, skipped, headerMap });
  } catch (err) {
    next(err);
  }
});

// ── Students (§3, §6) ────────────────────────────────────────────────────────

// Search any student in the school (no teacher↔student permission layer).
router.get("/students", authAny, loadMembership, async (req, res, next) => {
  try {
    const q = String(req.query.query || "").trim();
    const cls = String(req.query.class || "").trim();
    const filter = { schoolId: req.schoolId, active: true };
    if (cls) filter.classGroup = cls;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ lastName: rx }, { firstName: rx }, { preferredName: rx }];
    }
    const students = await BehaviorStudent.find(filter)
      .select("lastName firstName preferredName classGroup grade")
      .sort({ lastName: 1, firstName: 1 })
      .limit(50)
      .lean();
    res.json({ ok: true, students });
  } catch (err) {
    next(err);
  }
});

// Full cross-teacher status + history for a student.
router.get("/students/:id", authAny, loadMembership, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
    const cutoff = Date.now() - fadeDays * DAY_MS;

    const incidents = await BehaviorIncident.find({ studentId: student._id })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    // Active count = THRESHOLD incidents within window, after reset, unspent.
    const activeCount = incidents.filter((inc) => {
      const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
      return (
        mode === "THRESHOLD" &&
        !inc.countedInNoticeId &&
        new Date(inc.timestamp).getTime() > resetAt &&
        new Date(inc.timestamp).getTime() > cutoff
      );
    }).length;

    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: -1 }).lean();

    res.json({
      ok: true,
      student,
      activeCount,
      triggerCount: config?.triggerCount ?? 3,
      noticesHomeCount: student.noticesHomeCount || 0,
      incidents,
      notices,
    });
  } catch (err) {
    next(err);
  }
});

// ── Behaviours (§5a) ─────────────────────────────────────────────────────────

// Standard behaviours + this teacher's own custom ones (custom is private).
router.get("/behaviors", authAny, loadMembership, async (req, res, next) => {
  try {
    const behaviors = await Behavior.find({
      schoolId: req.schoolId,
      active: true,
      $or: [{ scope: "standard" }, { scope: "custom", ownerTeacherId: req.membership._id }],
    })
      .sort({ scope: 1, sortOrder: 1, name: 1 })
      .lean();
    res.json({ ok: true, behaviors });
  } catch (err) {
    next(err);
  }
});

// Add a behaviour. Admin may add a standard (shared) one; any teacher may add a
// custom (private) one.
router.post("/behaviors", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const isAdmin = ["originator", "admin"].includes(req.membership.role);
    const wantStandard = req.body?.scope === "standard" && isAdmin;
    const doc = await Behavior.create({
      schoolId: req.schoolId,
      name: String(req.body?.name || "").trim(),
      description: String(req.body?.description || ""),
      triggerMode: req.body?.triggerMode === "IMMEDIATE" ? "IMMEDIATE" : "THRESHOLD",
      consequenceText: String(req.body?.consequenceText || ""),
      followUpType: ["none", "next_school_day", "custom_deadline"].includes(req.body?.followUpType)
        ? req.body.followUpType
        : "none",
      scope: wantStandard ? "standard" : "custom",
      ownerTeacherId: wantStandard ? null : req.membership._id,
    });
    if (!doc.name) {
      await Behavior.deleteOne({ _id: doc._id });
      return res.status(400).json({ ok: false, error: "name required" });
    }
    await audit(req.schoolId, "behavior.created", req, { meta: { name: doc.name, scope: doc.scope } });
    res.json({ ok: true, behavior: doc });
  } catch (err) {
    next(err);
  }
});

// ── Incident logging + trigger (§6, §7) ──────────────────────────────────────

router.post("/incidents", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const studentId = req.body?.studentId;
    const behaviorIds = Array.isArray(req.body?.behaviorIds)
      ? req.body.behaviorIds
      : req.body?.behaviorId
      ? [req.body.behaviorId]
      : [];
    const detailText = String(req.body?.detailText || "");
    if (!studentId || !behaviorIds.length) {
      return res.status(400).json({ ok: false, error: "studentId and behaviorIds required" });
    }

    const student = await BehaviorStudent.findOne({ _id: studentId, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    // Create one append-only incident per selected behaviour, snapshotting the
    // behaviour wording so later edits don't rewrite history (§5a).
    const createdIncidents = [];
    for (const bId of behaviorIds) {
      const behavior = await Behavior.findOne({ _id: bId, schoolId: req.schoolId }).lean();
      if (!behavior) continue;
      const inc = await BehaviorIncident.create({
        schoolId: req.schoolId,
        studentId: student._id,
        teacherId: req.membership._id,
        behaviorId: behavior._id,
        behaviorSnapshot: {
          name: behavior.name,
          description: behavior.description,
          triggerMode: behavior.triggerMode,
          consequenceText: behavior.consequenceText,
        },
        detailText,
        immediateFlag: behavior.triggerMode === "IMMEDIATE",
      });
      createdIncidents.push(inc.toObject());
    }
    if (!createdIncidents.length) {
      return res.status(400).json({ ok: false, error: "No valid behaviours" });
    }

    // Evaluate the trigger across ALL of the student's incidents (cross-teacher).
    const priorIncidents = await BehaviorIncident.find({ studentId: student._id }).lean();
    let notice = null;
    for (const inc of createdIncidents) {
      const others = priorIncidents.filter((p) => String(p._id) !== String(inc._id));
      const decision = evaluateIncident({
        newIncident: inc,
        priorIncidents: others,
        config: { triggerCount: config?.triggerCount ?? 3, fadeWindowDays: config?.fadeWindowDays ?? 30 },
        student,
      });
      if (decision.shouldNotify) {
        notice = await fireNotice({ req, student, config, decision });
        break; // one notice per submission; counter reset handled in fireNotice
      }
    }

    res.json({
      ok: true,
      incidents: createdIncidents.map((i) => ({ _id: i._id, behaviorName: i.behaviorSnapshot.name })),
      notice: notice ? { _id: notice._id, status: notice.status, cancelUntil: notice.cancelUntil, ccVp: notice.ccVp } : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Build, persist (queued), and schedule a notice home. Marks the contributing
 * incidents as spent and resets the student's shared threshold counter while
 * keeping history. Composes the note via AI with deterministic fallback.
 */
async function fireNotice({ req, student, config, decision }) {
  const contributing = decision.contributingIncidents;
  const contribIds = contributing.map((i) => i._id);

  // Resolve "from teachers" — the teachers whose incidents make up the strikes.
  const teacherIds = [...new Set(contributing.map((i) => String(i.teacherId)))];
  const teachers = await BehaviorTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  const fromTeachers = contributing.map((i) => ({
    teacherId: i.teacherId,
    name: teacherById[String(i.teacherId)]?.name || "",
    behaviorName: i.behaviorSnapshot?.name || "",
  }));

  const consequenceTexts = [
    ...new Set(contributing.map((i) => i.behaviorSnapshot?.consequenceText).filter(Boolean)),
  ];

  // Channels: school default (enabled) unless the teacher overrode per notice.
  let channels = [];
  if (Array.isArray(req.body?.channelOverride) && req.body.channelOverride.length) {
    channels = req.body.channelOverride.filter((c) => ["email", "edsby"].includes(c));
  } else {
    if (config?.channels?.edsby) channels.push("edsby");
    if (config?.channels?.email) channels.push("email");
  }
  if (!channels.length) channels = ["email"];

  // Recipients: parents (+ VP if CC rule applies).
  const recipients = (student.parents || [])
    .filter((p) => p.email || p.edsbyParentId)
    .map((p) => ({ role: "parent", name: p.name, email: p.email, edsbyParentId: p.edsbyParentId }));
  if (decision.ccVp && config?.vp?.email) {
    recipients.push({ role: "vp", name: config.vp.name, email: config.vp.email });
  }

  // Compose the note (AI with fail-safe fallback).
  const firstTs = contributing.length ? new Date(contributing[0].timestamp).getTime() : Date.now();
  const daysSinceFirst = Math.max(0, Math.round((Date.now() - firstTs) / DAY_MS));
  const me = teacherById[String(req.membership._id)] || (await BehaviorTeacher.findById(req.membership._id).lean());
  const signature = (me?.signature || config?.branding?.signatureBlock || "").trim();

  const ctx = {
    studentName: student.preferredName || student.firstName || "your child",
    pronoun: student.pronoun || "",
    incidents: contributing.map((i) => ({
      behaviorName: i.behaviorSnapshot?.name,
      teacherName: teacherById[String(i.teacherId)]?.name || "",
      date: i.timestamp,
      detail: i.detailText || "",
    })),
    consequences: consequenceTexts,
    sequenceNo: decision.sequenceNo,
    daysSinceFirst,
    schoolName: config?.branding?.schoolName || "",
    signature,
    toneGuidance: config?.branding?.toneGuidance || "",
    ccVp: decision.ccVp,
  };
  const { text, aiUsed } = await composeNotice(ctx, { aiClient: makeDefaultAiClient(config || {}) });

  const cancelWindow = config?.cancelWindowSeconds ?? 60;
  const notice = await BehaviorNotice.create({
    schoolId: req.schoolId,
    studentId: student._id,
    periodNo: 1,
    sequenceNo: decision.sequenceNo,
    reason: decision.reason,
    fromTeachers,
    triggeringIncidentIds: contribIds,
    consequenceTexts,
    channels,
    recipients,
    ccVp: decision.ccVp,
    renderedText: text,
    aiUsed,
    status: "queued",
    sentByTeacherId: req.membership._id,
    cancelUntil: new Date(Date.now() + cancelWindow * 1000),
  });

  // Mark contributing incidents as spent (keep history) and reset the shared
  // counter — only the still-unspent ones, so parallel notices don't double-spend.
  await BehaviorIncident.updateMany(
    { _id: { $in: contribIds }, countedInNoticeId: null },
    { $set: { countedInNoticeId: notice._id } }
  );
  await BehaviorStudent.updateOne(
    { _id: student._id },
    { $set: { thresholdResetAt: new Date(), lastNoticeAt: new Date() }, $inc: { noticesHomeCount: 1 } }
  );

  // Schedule dispatch after the cancellable window (auto-send mode).
  if (config?.aiSendMode !== "draft") {
    scheduleDispatch(notice._id, cancelWindow);
  }
  return notice;
}

// Cancel a queued notice during its cancellable window (§8 send model).
router.post("/notices/:id/cancel", authAny, loadMembership, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (notice.status !== "queued") {
      return res.status(409).json({ ok: false, error: `Cannot cancel a ${notice.status} notice` });
    }
    notice.status = "cancelled";
    await notice.save();
    await audit(req.schoolId, "notice.cancelled", req, { studentId: notice.studentId, noticeId: notice._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Single notice (communication-history detail view).
router.get("/notices/:id", authAny, loadMembership, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    res.json({ ok: true, notice });
  } catch (err) {
    next(err);
  }
});

export default router;
