// backend/controllers/teacherProfileController.js
import TeacherProfile from "../models/TeacherProfile.js";

/**
 * GET /api/profile/me
 * In dev mode, returns the single teacher profile.
 * If none exists, create it with defaults.
 */
export async function getMyProfile(req, res) {
  try {
    // In real auth: use req.user.id
    let profile = await TeacherProfile.findOne();

    if (!profile) {
      profile = await TeacherProfile.create({});
    }

    const plain = profile.toObject();
    delete plain.__v;

    res.json(plain);
  } catch (err) {
    console.error("Error loading profile:", err);
    res.status(500).json({ error: "Failed to load profile" });
  }
}

/**
 * PUT /api/profile/me
 * Saves updates to the one existing teacher profile.
 */
export async function updateMyProfile(req, res) {
  try {
    const update = {
      displayName: req.body.displayName ?? "",
      schoolName: req.body.schoolName ?? "",
      countryRegion: req.body.countryRegion ?? "",

      gradesTaught: Array.isArray(req.body.gradesTaught)
        ? req.body.gradesTaught.filter(Boolean)
        : [],

      subjectsTaught: Array.isArray(req.body.subjectsTaught)
        ? req.body.subjectsTaught.filter(Boolean)
        : [],

      curriculumLenses: Array.isArray(req.body.curriculumLenses)
        ? req.body.curriculumLenses.filter(Boolean)
        : [],

      defaultGrade: req.body.defaultGrade ?? "",
      defaultSubject: req.body.defaultSubject ?? "",
      defaultDifficulty: req.body.defaultDifficulty || "MEDIUM",
      defaultDurationMinutes:
        typeof req.body.defaultDurationMinutes === "number"
          ? req.body.defaultDurationMinutes
          : 45,
      defaultLearningGoal: req.body.defaultLearningGoal || "REVIEW",

      prefersMovementTasks:
        typeof req.body.prefersMovementTasks === "boolean"
          ? req.body.prefersMovementTasks
          : true,
      prefersDrawingMimeTasks:
        typeof req.body.prefersDrawingMimeTasks === "boolean"
          ? req.body.prefersDrawingMimeTasks
          : true,
    };

    let profile = await TeacherProfile.findOne();

    if (!profile) {
      profile = await TeacherProfile.create(update);
    } else {
      profile = await TeacherProfile.findOneAndUpdate({}, update, {
        new: true,
      });
    }

    const plain = profile.toObject();
    delete plain.__v;

    res.json(plain);
  } catch (err) {
    console.error("Error saving profile:", err);
    res.status(500).json({ error: "Failed to save profile" });
  }
}
