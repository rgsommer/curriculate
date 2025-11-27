import mongoose from "mongoose";

const { Schema } = mongoose;

// Assessment categories used for deeper breakdown of AI / rubric scoring
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
    }, // human-readable name
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
    // Teacher or facilitator display name (used in some UIs)
    displayName: { type: String, default: "" },

    // Explicit presenter fields used in the TeacherApp UI
    presenterName: { type: String, default: "" },
    presenterRole: { type: String, default: "" },

    // NEW: canonical presenter title used by the TeacherProfile page
    presenterTitle: { type: String, default: "" },

    // Legacy "title" field – kept in sync with presenterTitle so that
    // any older views or emails that still read `title` continue to work.
    title: { type: String, default: "" },

    schoolName: { type: String, default: "" },

    // The email address where reports / transcripts get sent
    email: {
      type: String,
      required: false,
      default: "",
      lowercase: true,
      trim: true,
    },

    // Optional separate report email (if ever used)
    reportEmail: {
      type: String,
      required: false,
      default: "",
      lowercase: true,
      trim: true,
    },

    // Subjects, grades, etc. — optional for non-school users
    gradesTaught: { type: [String], default: [] },
    subjectsTaught: { type: [String], default: [] },

    // Worldview / pedagogical “perspectives” multi-select
    // e.g. ["christian-biblical", "character-formation", ...]
    perspectives: {
      type: [String],
      default: [],
    },

    // Whether AI / email reports should include per-student breakdowns
    includeIndividualReports: {
      type: Boolean,
      default: false,
    },
    // Legacy alias – some code may still reference this
    includeStudentReports: {
      type: Boolean,
      default: false,
    },

    // Optional global toggle for AI transcript / reporting tools
    aiTranscriptEnabled: {
      type: Boolean,
      default: true,
    },

    // Whether to include a narrative session summary in reports
    includeSessionSummary: {
      type: Boolean,
      default: true,
    },

    // Teacher preferences for AI task-set generator
    defaultGrade: { type: String, default: "" },
    defaultSubject: { type: String, default: "" },
    defaultDifficulty: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD"],
      default: "MEDIUM",
    },
    defaultDurationMinutes: {
      type: Number,
      default: 45,
    },
    defaultLearningGoal: {
      type: String,
      enum: ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"],
      default: "REVIEW",
    },
    defaultNumTasks: {
      type: Number,
      default: 8,
    },
    // Optional list of preferred task types to bias generation
    defaultTaskTypes: {
      type: [String],
      default: [],
    },

    // How many stations the teacher typically uses in a room
    defaultStations: {
      type: Number,
      default: 8,
    },

    // User-defined rubric categories for per-student breakdown
    assessmentCategories: {
      type: [AssessmentCategorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Keep presenterTitle and title in sync at the model level whenever saved
TeacherProfileSchema.pre("save", function (next) {
  if (this.presenterTitle && !this.title) {
    this.title = this.presenterTitle;
  }
  if (this.title && !this.presenterTitle) {
    this.presenterTitle = this.title;
  }
  next();
});

const TeacherProfile =
  mongoose.models.TeacherProfile ||
  mongoose.model("TeacherProfile", TeacherProfileSchema);

export default TeacherProfile;
