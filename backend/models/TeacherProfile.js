import mongoose from "mongoose";

const { Schema } = mongoose;

// Assessment categories used for deeper breakdown of AI scoring
const AssessmentCategorySchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    }, // canonical ID e.g. "knowledge"
    label: {
      type: String,
      required: true,
      trim: true,
    }, // human readable name
    description: {
      type: String,
      default: "",
      trim: true,
    },
    weight: {
      type: Number,
      default: 25,
    },
  },
  { _id: false }
);

const TeacherProfileSchema = new Schema(
  {
    // Teacher or facilitator display name
    displayName: { type: String, default: "" },

    // School, organization, retreat, conference, company, etc.
    schoolName: { type: String, default: "" },

    // The email address where reports/transcripts get sent
    email: {
      type: String,
      required: false,
      default: "",
      lowercase: true,
      trim: true,
    },

    // Subjects, grades, etc. — optional for non-school users
    gradesTaught: { type: [String], default: [] },
    subjectsTaught: { type: [String], default: [] },

    // NEW — universal “perspectives” (multi-select worldview/approach)
    // Examples: ["christian-biblical", "leadership-development"]
    perspectives: { type: [String], default: [] },

    // Whether to include individual one-page reports in PDF
    includeIndividualReports: {
      type: Boolean,
      default: true,
    },

    // Teacher preferences for AI task generator
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

    // Optional: behaviour preferences for the task generator
    prefersMovementTasks: { type: Boolean, default: true },
    prefersDrawingMimeTasks: { type: Boolean, default: true },

    // User-defined rubric categories for per-student breakdown
    assessmentCategories: {
      type: [AssessmentCategorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

const TeacherProfile =
  mongoose.models.TeacherProfile ||
  mongoose.model("TeacherProfile", TeacherProfileSchema);

export default TeacherProfile;
