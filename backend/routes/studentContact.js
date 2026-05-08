// backend/routes/studentContact.js
//
// Public read + write endpoints used by:
//   - student-app on join (peeks for a stored email; submits one if missing)
//   - Pulse Grading flow (looks up emails for linked students)
//
// Authentication is by edsbyId in the URL — i.e., possession-based. We
// only persist contact data for students who have legitimately picked
// themselves from a class roster, since handleStudentJoinRoom validates
// the edsbyId against the bound roster before the email lands here.

import express from "express";
import StudentContact from "../models/StudentContact.js";

const router = express.Router();

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /student-contact/:edsbyId
//   → { ok, hasEmail, email?, hasParentEmail, parentEmailDeclined,
//        firstName?, lastName? }
router.get("/:edsbyId", async (req, res) => {
  try {
    const edsbyId = String(req.params.edsbyId || "").trim();
    if (!edsbyId) return res.status(400).json({ ok: false, error: "edsbyId required" });

    const doc = await StudentContact.findOne({ edsbyId }).lean();
    if (!doc) {
      return res.json({ ok: true, hasEmail: false, hasParentEmail: false, parentEmailDeclined: false });
    }
    return res.json({
      ok: true,
      hasEmail: !!doc.email,
      email: doc.email || "",
      hasParentEmail: !!doc.parentEmail,
      parentEmailDeclined: !!doc.parentEmailDeclined,
      firstName: doc.firstName || "",
      lastName: doc.lastName || "",
    });
  } catch (err) {
    console.error("GET /student-contact/:edsbyId error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Lookup failed." });
  }
});

// POST /student-contact/:edsbyId/parent-email
//   Body: { parentEmail?, declined? }
//   - parentEmail set → store & clear declined
//   - declined: true   → mark declined, don't store an email
router.post("/:edsbyId/parent-email", async (req, res) => {
  try {
    const edsbyId = String(req.params.edsbyId || "").trim();
    if (!edsbyId) return res.status(400).json({ ok: false, error: "edsbyId required" });

    const { parentEmail, declined } = req.body || {};
    const cleaned = String(parentEmail || "").trim().toLowerCase();
    if (cleaned && !VALID_EMAIL.test(cleaned)) {
      return res.status(400).json({ ok: false, error: "Invalid email." });
    }

    const set = {};
    if (cleaned) {
      set.parentEmail = cleaned;
      set.parentEmailUpdatedAt = new Date();
      set.parentEmailDeclined = false;
    } else if (declined === true) {
      set.parentEmailDeclined = true;
    } else {
      return res.status(400).json({ ok: false, error: "Provide parentEmail or declined: true." });
    }

    const doc = await StudentContact.findOneAndUpdate(
      { edsbyId },
      { $set: set, $setOnInsert: { edsbyId } },
      { upsert: true, new: true }
    );

    return res.json({
      ok: true,
      hasParentEmail: !!doc.parentEmail,
      parentEmailDeclined: !!doc.parentEmailDeclined,
    });
  } catch (err) {
    console.error("POST /student-contact/:edsbyId/parent-email error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Save failed." });
  }
});

// POST /student-contact/:edsbyId/email
//   Body: { email, firstName?, lastName?, studentId?, teacherEmail?, className? }
//   Upserts. The first time an email is set, all subsequent submissions
//   without one are ignored (clients can't blank a stored address).
router.post("/:edsbyId/email", async (req, res) => {
  try {
    const edsbyId = String(req.params.edsbyId || "").trim();
    if (!edsbyId) return res.status(400).json({ ok: false, error: "edsbyId required" });

    const {
      email,
      firstName,
      lastName,
      studentId,
      teacherEmail,
      className,
    } = req.body || {};

    const cleanedEmail = String(email || "").trim().toLowerCase();
    if (cleanedEmail && !VALID_EMAIL.test(cleanedEmail)) {
      return res.status(400).json({ ok: false, error: "Invalid email." });
    }

    const update = {
      $setOnInsert: { edsbyId },
    };
    const set = {};
    if (firstName) set.firstName = String(firstName).trim();
    if (lastName) set.lastName = String(lastName).trim();
    if (studentId) set.studentId = String(studentId).trim();
    if (cleanedEmail) {
      set.email = cleanedEmail;
      set.emailUpdatedAt = new Date();
    }
    if (Object.keys(set).length) update.$set = set;

    if (teacherEmail) {
      // Push a teacher-touch record (deduped by teacherEmail+className).
      // We do a fetch-and-merge rather than $addToSet because we want to
      // bump lastSeenAt on existing entries too.
      const existing = await StudentContact.findOne({ edsbyId }).lean();
      const tEmail = String(teacherEmail).trim().toLowerCase();
      const cName = String(className || "").trim();
      const merged = (existing?.knownTeachers || []).filter(
        (t) => !(t.teacherEmail === tEmail && t.className === cName)
      );
      merged.push({ teacherEmail: tEmail, className: cName, lastSeenAt: new Date() });
      // Cap at 20 most recent to keep the array bounded
      merged.sort((a, b) => (new Date(b.lastSeenAt) - new Date(a.lastSeenAt)));
      update.$set = { ...(update.$set || {}), knownTeachers: merged.slice(0, 20) };
    }

    const doc = await StudentContact.findOneAndUpdate(
      { edsbyId },
      update,
      { upsert: true, new: true }
    );

    return res.json({
      ok: true,
      hasEmail: !!doc.email,
      email: doc.email || "",
    });
  } catch (err) {
    console.error("POST /student-contact/:edsbyId/email error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Save failed." });
  }
});

export default router;
