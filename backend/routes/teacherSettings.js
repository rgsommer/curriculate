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
      settings: { hideGradesFromStudents: !!doc?.hideGradesFromStudents },
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

    const hide = !!req.body?.hideGradesFromStudents;
    await TeacherSettings.findOneAndUpdate(
      { teacherEmail },
      { $set: { teacherEmail, hideGradesFromStudents: hide } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // The serving path caches this for a minute; a teacher who has just
    // flipped it should not have to wait to see the effect.
    invalidateGradeVisibility(teacherEmail);

    console.log(`[teacher-settings] ${teacherEmail} hideGradesFromStudents=${hide}`);
    return res.json({ ok: true, settings: { hideGradesFromStudents: hide } });
  } catch (err) {
    console.error("[teacher-settings put]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not save settings." });
  }
});

export default router;
