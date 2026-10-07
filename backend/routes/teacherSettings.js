// backend/routes/teacherSettings.js
//
// Per-teacher preferences. Scoped by teacherEmail, like everything else the
// teacher owns.
import express from "express";
import TeacherSettings from "../models/TeacherSettings.js";
import { invalidateGradeVisibility } from "../utils/gradeVisibility.js";

const router = express.Router();

function emailOf(req) {
  const raw = req.query.teacherEmail ?? req.body?.teacherEmail ?? "";
  const e = String(raw).trim().toLowerCase();
  return e.includes("@") ? e : "";
}

// GET /teacher-settings?teacherEmail=...
router.get("/", async (req, res) => {
  try {
    const teacherEmail = emailOf(req);
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "Valid teacherEmail is required." });
    const doc = await TeacherSettings.findOne({ teacherEmail }).lean();
    return res.json({
      ok: true,
      settings: {
        hideGradesFromStudents: !!doc?.hideGradesFromStudents,
        // Absent means never set, and the default is on.
        notifyStudentsOnNewResult: doc?.notifyStudentsOnNewResult !== false,
      },
    });
  } catch (err) {
    console.error("[teacher-settings get]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not load settings." });
  }
});

// PUT /teacher-settings  { teacherEmail, hideGradesFromStudents }
router.put("/", async (req, res) => {
  try {
    const teacherEmail = emailOf(req);
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "Valid teacherEmail is required." });

    // Only touch what the caller actually sent. The page saves one toggle at
    // a time, and writing both every time would let a stale copy of one
    // setting undo a change to the other.
    const set = { teacherEmail };
    if ("hideGradesFromStudents" in (req.body || {})) {
      set.hideGradesFromStudents = !!req.body.hideGradesFromStudents;
    }
    if ("notifyStudentsOnNewResult" in (req.body || {})) {
      set.notifyStudentsOnNewResult = !!req.body.notifyStudentsOnNewResult;
    }
    const hide = set.hideGradesFromStudents;
    const saved = await TeacherSettings.findOneAndUpdate(
      { teacherEmail },
      { $set: set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // The serving path caches this for a minute; a teacher who has just
    // flipped it should not have to wait to see the effect.
    invalidateGradeVisibility(teacherEmail);

    console.log(
      `[teacher-settings] ${teacherEmail} ` +
      Object.entries(set).filter(([k]) => k !== "teacherEmail").map(([k, v]) => `${k}=${v}`).join(" ")
    );
    return res.json({
      ok: true,
      settings: {
        hideGradesFromStudents: !!saved.hideGradesFromStudents,
        notifyStudentsOnNewResult: saved.notifyStudentsOnNewResult !== false,
      },
    });
  } catch (err) {
    console.error("[teacher-settings put]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not save settings." });
  }
});

export default router;
