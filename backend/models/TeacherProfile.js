// backend/models/TeacherProfile.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const TeacherProfileSchema = new Schema(
  {
    // For now dev mode → no authentication, no userId needed
    // If you later add auth, add: user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true }

    displayName: { type: String, default: "" },
    schoolName: { type: String, default: "" },
    countryRegion: { type: String, default: "" },

    gradesTaught: { type: [String], default: [] },
    subjectsTaught: { type: [String], default: [] },
    curriculumLenses: { type: [String], default: [] },

    defaultGrade: { type: String, default: "" },
    defaultSubject: { type: String, default: "" },
    defaultDifficulty: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD"],
      default: "MEDIUM",
    },
    defaultDurationMinutes: { type: Number, default: 45 },
    defaultLearningGoal: {
      type: String,
      enum: ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"],
      default: "REVIEW",
    },

    prefersMovementTasks: { type: Boolean, default: true },
    prefersDrawingMimeTasks: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const TeacherProfile =
  mongoose.models.TeacherProfile ||
  mongoose.model("TeacherProfile", TeacherProfileSchema);

export default TeacherProfile;
