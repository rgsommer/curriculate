// backend/models/TeacherProfile.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const teacherProfileSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },

    displayName: { type: String },
    schoolName: { type: String },
    countryRegion: { type: String },

    gradesTaught: [{ type: String }],
    subjectsTaught: [{ type: String }],

    curriculumLenses: [
      {
        type: String,
        enum: [
          "BIBLICAL_CHRISTIAN",
          "CLASSICAL_CHRISTIAN",
          "GENERIC_CHRISTIAN",
          "SECULAR_NEUTRAL",
        ],
      },
    ],

    defaultGrade: { type: String },
    defaultSubject: { type: String },
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
    prefersFrenchLanguageSupport: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const TeacherProfile = mongoose.model("TeacherProfile", teacherProfileSchema);
export default TeacherProfile;
