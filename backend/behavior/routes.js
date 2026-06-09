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
import BehaviorFollowup from "./models/BehaviorFollowup.js";

import { evaluateIncident, activeThresholdIncidents } from "./lib/triggerLogic.js";
import { nextSchoolDay } from "./lib/schoolCalendar.js";
import { encrypt } from "./lib/secretBox.js";
import { seedBehaviorDocs } from "./lib/seedBehaviors.js";
import { parseRoster, parseRosterFile } from "./lib/rosterImport.js";
import { composeNotice, makeDefaultAiClient } from "./lib/aiNote.js";
import { scheduleDispatch, dispatchNotice } from "./lib/notify.js";

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
// Never expose the encrypted Edsby cookie to the client; surface a boolean.
function sanitizeConfig(config) {
  if (!config) return config;
  const c = { ...config };
  if (c.edsby) {
    c.edsby = {
      enabled: !!c.edsby.enabled,
      baseUrl: c.edsby.baseUrl || "",
      userNid: c.edsby.userNid || "",
      jver: c.edsby.jver || "",
      cver: c.edsby.cver || "",
      zoomId: c.edsby.zoomId || "",
      cookieConfigured: !!c.edsby.cookieEnc,
      formkeyConfigured: !!c.edsby.formkeyEnc,
      updatedAt: c.edsby.updatedAt || null,
    };
  }
  return c;
}

router.get("/me", authAny, async (req, res, next) => {
  try {
    const membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (!membership) return res.json({ ok: true, membership: null, needsSetup: true });
    const school = await BehaviorSchool.findById(membership.schoolId).lean();
    const config = await BehaviorConfig.findOne({ schoolId: membership.schoolId }).lean();
    res.json({ ok: true, membership, school, config: sanitizeConfig(config) });
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
    res.json({ ok: true, config: sanitizeConfig(config) });
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
      "reminderTime", "manualNonSchoolDays",
    ];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    const config = await BehaviorConfig.findOneAndUpdate(
      { schoolId: req.schoolId },
      { $set: update },
      { new: true }
    ).lean();
    await audit(req.schoolId, "config.updated", req, { meta: { fields: Object.keys(update) } });
    res.json({ ok: true, config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

// Connect Edsby (admin): store the base URL + session cookie (encrypted). The
// cookie is write-only — it's never returned. Posting per-parent happens via
// the EdsbyProvider once channels.edsby is enabled.
router.put("/config/edsby", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const update = { "edsby.updatedAt": new Date() };
    if ("enabled" in b) update["edsby.enabled"] = !!b.enabled;
    if ("baseUrl" in b) update["edsby.baseUrl"] = String(b.baseUrl || "").trim().replace(/\/+$/, "");
    // Non-secret identifiers stored plainly.
    for (const k of ["userNid", "jver", "cver", "zoomId"]) {
      if (k in b) update[`edsby.${k}`] = String(b[k] || "").trim();
    }
    // Secrets encrypted; only updated when a fresh value is supplied.
    if (b.cookie) update["edsby.cookieEnc"] = encrypt(String(b.cookie));
    if (b.formkey) update["edsby.formkeyEnc"] = encrypt(String(b.formkey));
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: update });
    await audit(req.schoolId, "config.edsby_updated", req, {
      meta: { enabled: update["edsby.enabled"], baseUrl: update["edsby.baseUrl"], cookieSet: !!b.cookie, formkeySet: !!b.formkey },
    });
    res.json({ ok: true });
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
    // Sorted grade → class → name so the client can group by grade directly.
    // Returns the whole roster when there's no query (for the grouped picker).
    const students = await BehaviorStudent.find(filter)
      .select("lastName firstName preferredName classGroup grade")
      .sort({ grade: 1, classGroup: 1, lastName: 1, firstName: 1 })
      .limit(q ? 50 : 2000)
      .lean();

    // Per-student active THRESHOLD count (for list colouring). Unspent incidents
    // within the fade window — spent ones already carry countedInNoticeId.
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const triggerCount = config?.triggerCount ?? 3;
    const cutoff = new Date(Date.now() - fadeDays * DAY_MS);
    const agg = await BehaviorIncident.aggregate([
      {
        $match: {
          schoolId: req.schoolId,
          studentId: { $in: students.map((s) => s._id) },
          countedInNoticeId: null,
          "behaviorSnapshot.triggerMode": "THRESHOLD",
          timestamp: { $gt: cutoff },
        },
      },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const cnt = Object.fromEntries(agg.map((a) => [String(a._id), a.n]));
    const out = students.map((s) => ({ ...s, activeCount: cnt[String(s._id)] || 0 }));
    res.json({ ok: true, students: out, triggerCount });
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

    // Enrich incidents with the logging teacher's name for display.
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const incidentsOut = incidents.map((i) => ({ ...i, teacherName: tName[String(i.teacherId)] || "" }));

    res.json({
      ok: true,
      student,
      activeCount,
      triggerCount: config?.triggerCount ?? 3,
      noticesHomeCount: student.noticesHomeCount || 0,
      incidents: incidentsOut,
      notices,
    });
  } catch (err) {
    next(err);
  }
});

// Add a single student (admin) — used by the Setup "Add test student" button
// and any one-off addition outside a bulk import.
router.post("/students", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.lastName && !b.firstName && !b.preferredName) {
      return res.status(400).json({ ok: false, error: "A name is required" });
    }
    const parents = (Array.isArray(b.parents) ? b.parents : [])
      .filter((p) => p && (p.email || p.name || p.edsbyParentId))
      .map((p) => ({
        name: String(p.name || "").trim(),
        email: String(p.email || "").trim().toLowerCase(),
        edsbyParentId: String(p.edsbyParentId || "").trim(),
      }));
    const student = await BehaviorStudent.create({
      schoolId: req.schoolId,
      externalId: String(b.externalId || "").trim(),
      lastName: String(b.lastName || "").trim(),
      firstName: String(b.firstName || "").trim(),
      preferredName: String(b.preferredName || "").trim(),
      gender: String(b.gender || "").trim(),
      classGroup: String(b.classGroup || "").trim(),
      grade: String(b.grade || "").trim(),
      dob: b.dob ? new Date(b.dob) : null,
      parents,
    });
    await audit(req.schoolId, "student.created", req, {
      studentId: student._id,
      meta: { name: `${student.firstName} ${student.lastName}`.trim(), test: !!b.test },
    });
    res.json({ ok: true, student });
  } catch (err) {
    next(err);
  }
});

// Delete a student (admin). Hard delete + cascade their incidents and notices —
// intended for cleaning up test data. The audit entry of the deletion is kept.
router.delete("/students/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const inc = await BehaviorIncident.deleteMany({ studentId: student._id });
    const not = await BehaviorNotice.deleteMany({ studentId: student._id });
    await BehaviorStudent.deleteOne({ _id: student._id });
    await audit(req.schoolId, "student.deleted", req, {
      studentId: student._id,
      meta: {
        name: `${student.firstName} ${student.lastName}`.trim(),
        incidentsRemoved: inc.deletedCount,
        noticesRemoved: not.deletedCount,
      },
    });
    res.json({ ok: true, incidentsRemoved: inc.deletedCount, noticesRemoved: not.deletedCount });
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
      keyword: String(req.body?.keyword || "").trim(),
      triggerMode: ["THRESHOLD", "IMMEDIATE", "INTERACTION"].includes(req.body?.triggerMode) ? req.body.triggerMode : "THRESHOLD",
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

// Can the caller manage this behaviour? Admin/originator for standard; the owner
// for a custom one. (Edits don't rewrite history — incidents snapshot at log time.)
function canManageBehavior(membership, beh) {
  if (beh.scope === "standard") return ["originator", "admin"].includes(membership.role);
  return String(beh.ownerTeacherId) === String(membership._id);
}

// Edit a behaviour (name, mode, consequence, follow-up, description).
router.put("/behaviors/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const beh = await Behavior.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!beh) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    if (!canManageBehavior(req.membership, beh)) {
      return res.status(403).json({ ok: false, error: "Not allowed to edit this behaviour" });
    }
    const b = req.body || {};
    if ("name" in b) beh.name = String(b.name || "").trim();
    if ("description" in b) beh.description = String(b.description || "");
    if ("keyword" in b) beh.keyword = String(b.keyword || "").trim();
    if ("consequenceText" in b) beh.consequenceText = String(b.consequenceText || "");
    if (["THRESHOLD", "IMMEDIATE", "INTERACTION"].includes(b.triggerMode)) beh.triggerMode = b.triggerMode;
    if (["none", "next_school_day", "custom_deadline"].includes(b.followUpType)) beh.followUpType = b.followUpType;
    if (typeof b.sortOrder === "number") beh.sortOrder = b.sortOrder;
    if (!beh.name) return res.status(400).json({ ok: false, error: "name required" });
    await beh.save();
    await audit(req.schoolId, "behavior.updated", req, { meta: { name: beh.name, scope: beh.scope } });
    res.json({ ok: true, behavior: beh });
  } catch (err) {
    next(err);
  }
});

// Remove a behaviour (soft delete — keeps history snapshots intact).
router.delete("/behaviors/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const beh = await Behavior.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!beh) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    if (!canManageBehavior(req.membership, beh)) {
      return res.status(403).json({ ok: false, error: "Not allowed to remove this behaviour" });
    }
    beh.active = false;
    await beh.save();
    await audit(req.schoolId, "behavior.removed", req, { meta: { name: beh.name, scope: beh.scope } });
    res.json({ ok: true });
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
    // Optional event time (teacher may set/adjust when the incident occurred).
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();
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
        timestamp,
      });
      createdIncidents.push(inc.toObject());
    }
    if (!createdIncidents.length) {
      return res.status(400).json({ ok: false, error: "No valid behaviours" });
    }

    // Evaluate the trigger across ALL of the student's incidents (cross-teacher).
    const priorIncidents = await BehaviorIncident.find({ studentId: student._id }).lean();
    let notice = null;
    if (req.body?.sendImmediately) {
      // Teacher chose "send now": fire a notice for these incidents PLUS any
      // accumulated queue, regardless of the behaviour's normal trigger mode.
      const createdIds = new Set(createdIncidents.map((i) => String(i._id)));
      const queued = activeThresholdIncidents(priorIncidents, {
        fadeWindowDays: config?.fadeWindowDays ?? 30,
        thresholdResetAt: student.thresholdResetAt,
        asOf: new Date(),
      }).filter((q) => !createdIds.has(String(q._id)));
      const sequenceNo = (student.noticesHomeCount || 0) + 1;
      notice = await fireNotice({
        req, student, config,
        decision: {
          shouldNotify: true,
          reason: "immediate",
          contributingIncidents: [...createdIncidents, ...queued],
          sequenceNo,
          ccVp: sequenceNo >= 2,
        },
      });
    } else {
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
    }

    // The incidents that make up the CURRENT trigger, for the teacher to review:
    // if a notice just fired, the incidents that fed it; otherwise the running
    // set still accumulating toward the threshold (cross-teacher). Enriched with
    // teacher name so the teacher sees who logged each one.
    let triggerRaw;
    if (notice) {
      triggerRaw = await BehaviorIncident.find({ studentId: student._id, countedInNoticeId: notice._id })
        .sort({ timestamp: 1 })
        .lean();
    } else {
      const all = await BehaviorIncident.find({ studentId: student._id }).lean();
      triggerRaw = activeThresholdIncidents(all, {
        fadeWindowDays: config?.fadeWindowDays ?? 30,
        thresholdResetAt: student.thresholdResetAt,
        asOf: new Date(),
      });
    }
    const tIds = [...new Set(triggerRaw.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const triggerIncidents = triggerRaw.map((i) => ({
      date: i.timestamp,
      teacher: tName[String(i.teacherId)] || "",
      offense: i.behaviorSnapshot?.name || "",
      comment: i.detailText || "",
    }));

    res.json({
      ok: true,
      incidents: createdIncidents.map((i) => ({ _id: i._id, behaviorName: i.behaviorSnapshot.name })),
      notice: notice ? { _id: notice._id, status: notice.status, cancelUntil: notice.cancelUntil, ccVp: notice.ccVp } : null,
      triggerIncidents,
      triggerCount: config?.triggerCount ?? 3,
    });
  } catch (err) {
    next(err);
  }
});

// Resolve the channels for a send: per-notice override, else the school default.
function resolveChannels(config, override) {
  if (Array.isArray(override) && override.length) {
    const c = override.filter((x) => ["email", "edsby"].includes(x));
    if (c.length) return c;
  }
  const c = [];
  if (config?.channels?.edsby) c.push("edsby");
  if (config?.channels?.email) c.push("email");
  return c.length ? c : ["email"];
}

// Double the first integer in a consequence string ("10× lines" -> "20× lines").
// Returns { text, changed } — changed=false for non-countable consequences.
function doubleConsequence(text) {
  const s = String(text || "");
  const m = s.match(/\d+/);
  if (!m) return { text: s, changed: false };
  const doubled = String(Number(m[0]) * 2);
  return { text: s.slice(0, m.index) + doubled + s.slice(m.index + m[0].length), changed: true };
}

/**
 * Shared core: compose the AI (or template) note, persist a queued notice, and
 * schedule its dispatch after the cancellable window. Used by both the incident
 * trigger path and the missed-consequence escalation.
 */
async function composeAndCreateNotice({
  schoolId, student, config, reason, sequenceNo, ccVp, sentByTeacherId,
  channels, consequenceTexts, fromTeachers, contextIncidents, triggeringIncidentIds,
}) {
  const recipients = (student.parents || [])
    .filter((p) => p.email || p.edsbyParentId)
    .map((p) => ({ role: "parent", name: p.name, email: p.email, edsbyParentId: p.edsbyParentId }));
  if (ccVp && config?.vp?.email) {
    recipients.push({ role: "vp", name: config.vp.name, email: config.vp.email });
  }

  const firstTs = contextIncidents.length ? new Date(contextIncidents[0].timestamp).getTime() : Date.now();
  const daysSinceFirst = Math.max(0, Math.round((Date.now() - firstTs) / DAY_MS));
  const sender = await BehaviorTeacher.findById(sentByTeacherId).lean();
  const signature = (sender?.signature || config?.branding?.signatureBlock || "").trim();

  // Background history for the AI's AWARENESS only (not to be summarized/listed):
  // distinct prior behaviour types, prior-notice count, recency of past activity.
  const contribIds = new Set((triggeringIncidentIds || []).map(String));
  const allInc = await BehaviorIncident.find({ studentId: student._id })
    .select("behaviorSnapshot.name timestamp")
    .lean();
  const priorInc = allInc.filter((i) => !contribIds.has(String(i._id)));
  const behaviourTypes = [...new Set(priorInc.map((i) => i.behaviorSnapshot?.name).filter(Boolean))];
  const lastPriorTs = priorInc.length ? Math.max(...priorInc.map((i) => new Date(i.timestamp).getTime())) : null;
  const history = {
    priorNotices: Math.max(0, sequenceNo - 1),
    priorIncidentCount: priorInc.length,
    behaviourTypes,
    lastBeforeDays: lastPriorTs ? Math.round((Date.now() - lastPriorTs) / DAY_MS) : null,
  };

  // Replace the legacy "nnn" name placeholder with the student's name; the AI
  // otherwise handles naming/pronouns naturally from studentName + pronoun.
  const studentName = student.preferredName || student.firstName || "your child";
  const personalize = (t) => String(t || "").replace(/\bnnn\b/gi, studentName);

  const ctx = {
    studentName,
    pronoun: student.pronoun || "",
    history,
    incidents: contextIncidents.map((i) => ({
      behaviorName: i.behaviorSnapshot?.name,
      teacherName: i.__teacherName || "",
      date: i.timestamp,
      detail: personalize(i.detailText || ""),
    })),
    consequences: consequenceTexts.map(personalize),
    sequenceNo,
    daysSinceFirst,
    schoolName: config?.branding?.schoolName || "",
    signature,
    toneGuidance: config?.branding?.toneGuidance || "",
    ccVp,
  };
  const { text, aiUsed } = await composeNotice(ctx, { aiClient: makeDefaultAiClient(config || {}) });

  const cancelWindow = config?.cancelWindowSeconds ?? 60;
  const notice = await BehaviorNotice.create({
    schoolId, studentId: student._id, periodNo: 1, sequenceNo, reason,
    fromTeachers, triggeringIncidentIds, consequenceTexts, channels, recipients, ccVp,
    renderedText: text, aiUsed, status: "queued", sentByTeacherId,
    cancelUntil: new Date(Date.now() + cancelWindow * 1000),
    autoDispatch: config?.aiSendMode !== "draft",
  });
  if (config?.aiSendMode !== "draft") scheduleDispatch(notice._id, cancelWindow);
  return notice;
}

// Create open follow-up tasks for the behaviours in a notice that carry a
// follow-up type (brief §8b). Due = next school day at 9am.
async function createFollowups({ schoolId, student, config, contributingIncidents, sentByTeacherId, noticeId, multiplier = 1, missLevel = 0 }) {
  const byBehavior = new Map();
  for (const inc of contributingIncidents) if (inc.behaviorId) byBehavior.set(String(inc.behaviorId), inc);
  const due = nextSchoolDay(new Date(), { manualNonSchoolDays: config?.manualNonSchoolDays || [] });
  const created = [];
  for (const [bid, inc] of byBehavior) {
    const beh = await Behavior.findById(bid).lean();
    if (!beh || beh.followUpType === "none") continue;
    created.push(
      await BehaviorFollowup.create({
        schoolId, studentId: student._id, behaviorId: bid, behaviorName: beh.name,
        consequenceText: inc.behaviorSnapshot?.consequenceText || beh.consequenceText,
        multiplier, missLevel, assignedByTeacherId: sentByTeacherId, noticeId, dueDate: due, status: "open",
      })
    );
  }
  return created;
}

/**
 * Fire a notice home from a trigger decision. Composes + queues the note, marks
 * contributing incidents spent, resets the shared threshold counter (threshold
 * notices only), and opens follow-up tasks for any consequence with a follow-up.
 */
async function fireNotice({ req, student, config, decision }) {
  const contributing = decision.contributingIncidents;
  const contribIds = contributing.map((i) => i._id);

  const teacherIds = [...new Set(contributing.map((i) => String(i.teacherId)))];
  const teachers = await BehaviorTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  for (const i of contributing) i.__teacherName = teacherById[String(i.teacherId)]?.name || "";
  const fromTeachers = contributing.map((i) => ({
    teacherId: i.teacherId,
    name: teacherById[String(i.teacherId)]?.name || "",
    behaviorName: i.behaviorSnapshot?.name || "",
  }));
  const consequenceTexts = [...new Set(contributing.map((i) => i.behaviorSnapshot?.consequenceText).filter(Boolean))];
  const channels = resolveChannels(config, req.body?.channelOverride);

  const notice = await composeAndCreateNotice({
    schoolId: req.schoolId, student, config, reason: decision.reason, sequenceNo: decision.sequenceNo,
    ccVp: decision.ccVp, sentByTeacherId: req.membership._id, channels, consequenceTexts, fromTeachers,
    contextIncidents: contributing, triggeringIncidentIds: contribIds,
  });

  await BehaviorIncident.updateMany(
    { _id: { $in: contribIds }, countedInNoticeId: null },
    { $set: { countedInNoticeId: notice._id } }
  );
  const counter = { $set: { lastNoticeAt: new Date() }, $inc: { noticesHomeCount: 1 } };
  if (decision.reason === "threshold") counter.$set.thresholdResetAt = new Date();
  await BehaviorStudent.updateOne({ _id: student._id }, counter);

  await createFollowups({
    schoolId: req.schoolId, student, config, contributingIncidents: contributing,
    sentByTeacherId: req.membership._id, noticeId: notice._id,
  });
  return notice;
}

// Send a queued notice now — bypasses the auto-send window (and is the manual
// send for draft mode). "Don't send" is the cancel route below.
router.post("/notices/:id/send", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (notice.status !== "queued") {
      return res.status(409).json({ ok: false, error: `Notice is already ${notice.status}` });
    }
    const result = await dispatchNotice(notice._id);
    await audit(req.schoolId, "notice.sent_manual", req, { studentId: notice.studentId, noticeId: notice._id });
    res.json({ ok: result.ok !== false, status: result.status || (result.ok ? "sent" : "failed") });
  } catch (err) {
    next(err);
  }
});

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

// ── Consequence follow-ups + morning reminders (§8b) ─────────────────────────

// A teacher's open follow-ups (default: mine). ?due=today limits to due-by-today.
router.get("/followups", authAny, loadMembership, async (req, res, next) => {
  try {
    const filter = { schoolId: req.schoolId, status: "open" };
    if (req.query.mine !== "0") filter.assignedByTeacherId = req.membership._id;
    if (req.query.due === "today") {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filter.dueDate = { $lte: end };
    }
    const followups = await BehaviorFollowup.find(filter).sort({ dueDate: 1 }).limit(200).lean();
    const sIds = [...new Set(followups.map((f) => String(f.studentId)))];
    const students = await BehaviorStudent.find({ _id: { $in: sIds } })
      .select("firstName lastName preferredName classGroup")
      .lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
    res.json({ ok: true, followups: followups.map((f) => ({ ...f, student: sById[String(f.studentId)] || null })) });
  } catch (err) {
    next(err);
  }
});

// Mark a follow-up Done / Not done / Waived. "Not done" escalates (§8b).
router.post("/followups/:id/status", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!["done", "not_done", "waived"].includes(status)) {
      return res.status(400).json({ ok: false, error: "status must be done | not_done | waived" });
    }
    const fu = await BehaviorFollowup.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!fu) return res.status(404).json({ ok: false, error: "Follow-up not found" });
    if (fu.status !== "open") return res.status(409).json({ ok: false, error: `Already ${fu.status}` });

    fu.status = status;
    fu.resolvedAt = new Date();
    fu.resolvedByTeacherId = req.membership._id;
    await fu.save();

    let escalation = null;
    if (status === "not_done") escalation = await escalateMissedConsequence(fu, req);
    await audit(req.schoolId, "followup.resolved", req, { studentId: fu.studentId, meta: { status, escalated: !!escalation } });
    res.json({ ok: true, escalation });
  } catch (err) {
    next(err);
  }
});

/**
 * Missed-consequence escalation (§8b): log a new incident, re-issue the
 * consequence doubled (once, capped at 2×), and send a new note home. A first
 * miss goes to parents; a second-or-later miss also CCs the VP. A fresh
 * follow-up is opened so the loop can be tracked.
 */
async function escalateMissedConsequence(fu, req) {
  const config = await BehaviorConfig.findOne({ schoolId: fu.schoolId }).lean();
  const student = await BehaviorStudent.findOne({ _id: fu.studentId });
  if (!student) return null;
  const beh = fu.behaviorId ? await Behavior.findById(fu.behaviorId).lean() : null;
  const sender = await BehaviorTeacher.findById(fu.assignedByTeacherId).lean();

  const newMissLevel = (fu.missLevel || 0) + 1;
  const firstMiss = newMissLevel === 1;

  // (a) Log a new (system-generated) incident for the missed consequence.
  const snapshot = {
    name: fu.behaviorName || beh?.name || "Missed consequence",
    description: beh?.description || "",
    triggerMode: "THRESHOLD",
    consequenceText: fu.consequenceText,
  };
  const sysInc = await BehaviorIncident.create({
    schoolId: fu.schoolId, studentId: student._id, teacherId: fu.assignedByTeacherId,
    behaviorId: fu.behaviorId || undefined, behaviorSnapshot: snapshot,
    detailText: `Missed consequence: ${fu.behaviorName}`, immediateFlag: false, systemGenerated: true,
  });

  // (b) Re-issue the consequence: double once (cap 2×); don't double again.
  let consequenceText = fu.consequenceText;
  let multiplier = fu.multiplier || 1;
  if (firstMiss) {
    const dbl = doubleConsequence(fu.consequenceText);
    consequenceText = dbl.text;
    if (dbl.changed) multiplier = Math.min(2, multiplier * 2);
  }

  // First miss → parents; second-or-later → parent + VP.
  const ccVp = newMissLevel >= 2;
  const sequenceNo = (student.noticesHomeCount || 0) + 1;
  const incObj = sysInc.toObject();
  incObj.__teacherName = sender?.name || "";

  const notice = await composeAndCreateNotice({
    schoolId: fu.schoolId, student, config, reason: "missed_consequence", sequenceNo, ccVp,
    sentByTeacherId: fu.assignedByTeacherId, channels: resolveChannels(config, null),
    consequenceTexts: [consequenceText],
    fromTeachers: [{ teacherId: fu.assignedByTeacherId, name: sender?.name || "", behaviorName: fu.behaviorName }],
    contextIncidents: [incObj], triggeringIncidentIds: [sysInc._id],
  });

  await BehaviorIncident.updateOne({ _id: sysInc._id }, { $set: { countedInNoticeId: notice._id } });
  await BehaviorStudent.updateOne({ _id: student._id }, { $inc: { noticesHomeCount: 1 }, $set: { lastNoticeAt: new Date() } });

  // (c) Open a fresh follow-up so the re-issued consequence is tracked too.
  const newFu = await BehaviorFollowup.create({
    schoolId: fu.schoolId, studentId: student._id, behaviorId: fu.behaviorId, behaviorName: fu.behaviorName,
    consequenceText, multiplier, missLevel: newMissLevel, assignedByTeacherId: fu.assignedByTeacherId,
    noticeId: notice._id, dueDate: nextSchoolDay(new Date(), { manualNonSchoolDays: config?.manualNonSchoolDays || [] }),
    status: "open",
  });

  return { noticeId: notice._id, followupId: newFu._id, missLevel: newMissLevel, multiplier, ccVp, consequenceText };
}

// Edit a queued notice's text before it sends (auto-send mode gives a window;
// editing extends that window so the edit isn't immediately swept out).
router.put("/notices/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (notice.status !== "queued") {
      return res.status(409).json({ ok: false, error: `Only queued notices can be edited (this one is ${notice.status})` });
    }
    if (typeof req.body?.renderedText === "string") notice.renderedText = req.body.renderedText;
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    notice.cancelUntil = new Date(Date.now() + (config?.cancelWindowSeconds ?? 60) * 1000);
    await notice.save();
    await audit(req.schoolId, "notice.edited", req, { noticeId: notice._id, studentId: notice.studentId });
    res.json({ ok: true, notice: { _id: notice._id, renderedText: notice.renderedText, status: notice.status, cancelUntil: notice.cancelUntil } });
  } catch (err) {
    next(err);
  }
});

// Append a PRIVATE teacher note to an incident — internal documentation, never
// sent to parents, but included in the AI Admin Summary (§ teacher request).
router.post("/incidents/:id/notes", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "text required" });
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    inc.teacherNotes.push({ teacherId: req.membership._id, name: req.membership.name || "", text, at: new Date() });
    await inc.save();
    await audit(req.schoolId, "incident.note_added", req, { studentId: inc.studentId });
    res.json({ ok: true, teacherNotes: inc.teacherNotes });
  } catch (err) {
    next(err);
  }
});

// AI "Admin Summary" for a student — scope "all" (full history) or "current"
// (just the active trigger incidents). Includes private teacher notes. Returns
// text for the client to copy to the clipboard. Fails safe to a plain digest.
router.post("/students/:id/admin-summary", authAny, loadMembership, async (req, res, next) => {
  try {
    const scope = req.body?.scope === "current" ? "current" : "all";
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    let incidents = await BehaviorIncident.find({ studentId: student._id }).sort({ timestamp: 1 }).lean();
    if (scope === "current") {
      const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
      const cutoff = Date.now() - (config?.fadeWindowDays ?? 30) * DAY_MS;
      incidents = incidents.filter((i) => {
        const mode = i.behaviorSnapshot?.triggerMode || (i.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
        return mode === "THRESHOLD" && !i.countedInNoticeId &&
          new Date(i.timestamp).getTime() > resetAt && new Date(i.timestamp).getTime() > cutoff;
      });
    }
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const lines = incidents.map((i) => {
      const d = new Date(i.timestamp).toLocaleString("en-CA");
      const notes = (i.teacherNotes || []).map((n) => `    • teacher note (${n.name || "teacher"}): ${n.text}`).join("\n");
      return `- ${d} — ${i.behaviorSnapshot?.name || ""}${i.detailText ? `: ${i.detailText}` : ""} [logged by ${tName[String(i.teacherId)] || "teacher"}]${notes ? `\n${notes}` : ""}`;
    });
    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: 1 }).lean();
    const noticeLines = notices.map((n) => `- ${new Date(n.sentAt || n.createdAt).toLocaleDateString("en-CA")}: notice #${n.sequenceNo} (${n.reason}, ${n.status})`);

    const name = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
    const ctxText =
      `Student: ${name}${student.classGroup ? ` (${student.classGroup})` : ""}.\n\n` +
      `${scope === "current" ? "CURRENT trigger incidents" : "FULL incident history"} (incl. private teacher notes):\n${lines.join("\n") || "(none)"}\n\n` +
      `Notices home:\n${noticeLines.join("\n") || "(none)"}`;
    const prompt =
      `Write a concise, objective summary of a student's behaviour record for a school administrator (VP/principal). ` +
      `Cover the pattern, frequency, types of behaviour, any escalation, and what has been communicated home. ` +
      `Be factual and brief. Use ONLY the data below — do not invent.\n\n${ctxText}`;

    let summary = `Behaviour summary — ${name}\n\n${ctxText}`; // deterministic fallback
    let aiUsed = false;
    try {
      const client = makeDefaultAiClient(config || {});
      if (client) {
        const out = await Promise.race([
          client.complete(prompt),
          new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 15000)),
        ]);
        if (out && String(out).trim()) { summary = String(out).trim(); aiUsed = true; }
      }
    } catch {
      /* fall back to the deterministic digest */
    }
    await audit(req.schoolId, "admin_summary.generated", req, { studentId: student._id, meta: { scope, aiUsed } });
    res.json({ ok: true, summary, aiUsed, scope });
  } catch (err) {
    next(err);
  }
});

export default router;
