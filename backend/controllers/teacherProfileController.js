// backend/controllers/teacherProfileController.js
import mongoose from "mongoose";
import TeacherProfile from "../models/TeacherProfile.js";

// Single-teacher / dev mode: fixed ObjectId as "the teacher"
const SINGLE_TEACHER_ID = new mongoose.Types.ObjectId(
  "64b000000000000000000000" // any valid 24-char hex string
);

export async function getMyProfile(req, res) {
  try {
    const userId = SINGLE_TEACHER_ID;
    //const userId = req.user._id;
    
    let profile = await TeacherProfile.findOne({ userId });

    if (!profile) {
      profile = await TeacherProfile.create({
        userId,
        displayName: "Default Teacher",
        gradesTaught: [],
        subjectsTaught: [],
        curriculumLenses: ["GENERIC_CHRISTIAN"],
      });
    }

    res.json(profile);
  } catch (err) {
    console.error("Error getting teacher profile", err);
    res.status(500).json({ error: "Failed to load teacher profile" });
  }
}

export async function updateMyProfile(req, res) {
  try {
    const userId = SINGLE_TEACHER_ID;

    const allowedFields = [
      "displayName",
      "schoolName",
      "countryRegion",
      "gradesTaught",
      "subjectsTaught",
      "curriculumLenses",
      "defaultGrade",
      "defaultSubject",
      "defaultDifficulty",
      "defaultDurationMinutes",
      "defaultLearningGoal",
      "prefersMovementTasks",
      "prefersDrawingMimeTasks",
      "prefersFrenchLanguageSupport",
    ];

    const update = {};
    for (const f of allowedFields) {
      if (f in req.body) update[f] = req.body[f];
    }

    const profile = await TeacherProfile.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true }
    );

    res.json(profile);
  } catch (err) {
    console.error("Error updating teacher profile", err);
    res.status(500).json({ error: "Failed to update teacher profile" });
  }
}
