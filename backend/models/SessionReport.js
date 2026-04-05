// backend/models/SessionReport.js
import mongoose from "mongoose";

const AttachmentSchema = new mongoose.Schema(
  {
    type: { type: String, default: "file" }, // photo | audio | video | file
    url: { type: String, default: "" },
    label: { type: String, default: "" },

    teamId: { type: String, default: "" },
    teamName: { type: String, default: "" },

    taskIndex: { type: Number, default: -1 },
    taskTitle: { type: String, default: "" },
    taskType: { type: String, default: "" },

    submittedAt: { type: Date, default: null },
  },
  { _id: false }
);

const TeamSchema = new mongoose.Schema(
  {
    teamId: { type: String, default: "" },
    teamName: { type: String, default: "" },
    members: { type: [String], default: [] },

    moodEntry: {
      moods: { type: [Number], default: [] },
      excitement: { type: String, default: "" },
      submittedAt: { type: Date, default: null },
    },

    tasksCompleted: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 }, // 0–100
    scorePercent: { type: Number, default: 0 }, // 0–100

    teamPoints: { type: Number, default: 0 },
    pointsPossible: { type: Number, default: 0 },

    exitFeedback: {
      rating: { type: Number, default: null },
      highlights: { type: String, default: "" },
      improvements: { type: String, default: "" },
      favoriteTask: { type: String, default: "" },
      learned: { type: String, default: "" },
      submittedAt: { type: Date, default: null },
    },

    scoringBreakdown: {
      percent: { type: Number, default: 0 },
      categories: {
        type: [
          {
            name: String,
            score: Number,
            max: Number,
          },
        ],
        default: [],
      },
    },
  },
  { _id: false }
);

const SessionReportSchema = new mongoose.Schema(
  {
    // Ownership / lookup
    ownerId: { type: String, index: true, required: true },
    roomCode: { type: String, index: true, required: true },

    // Session metadata (snapshot)
    schoolName: { type: String, default: "" },
    className: { type: String, default: "" },
    gradeLevel: { type: String, default: "" },

    taskSetName: { type: String, default: "" },
    subject: { type: String, default: "" },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    // Shared-run attribution (when a substitute presenter ran the task set)
    sharedToken: { type: String, default: "" },
    sharedFromTeacherId: { type: String, default: "" },
    sharedFromTeacherName: { type: String, default: "" },
    sharedFromTeacherEmail: { type: String, default: "" },
    runByPresenterId: { type: String, default: "" },
    runByPresenterName: { type: String, default: "" },
    runByPresenterEmail: { type: String, default: "" },

    // Email-ready summaries
    headline: { type: String, default: "" },
    overviewEmail: { type: String, default: "" },

    // AI summary (shape depends on your generator; store whole object)
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Parent note (print-ready)
    parentNote: { type: String, default: "" },

    // Full session transcript
    transcript: { type: mongoose.Schema.Types.Mixed, default: null },

    // Computed class aggregates
    classAverageScore: { type: Number, default: null },
    classAverageEngagement: { type: Number, default: null },

    // Noise sensor summary (class-level; not per-student)
    noiseSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    noiseSamples: { type: Array, default: [] },

    // Details
    teams: { type: [TeamSchema], default: [] },
    attachments: { type: [AttachmentSchema], default: [] },

    // Media submissions (photos/recordings submitted during session)
    mediaSubmissions: { type: Array, default: [] },

    // Optional: per-student stats (plan-gated in PDF rendering)
    perParticipant: { type: mongoose.Schema.Types.Mixed, default: null },

    // Scoring rubric categories used
    assessmentCategories: { type: Array, default: [] },

    // Optional: PDF URL if emailer generates one
    pdfUrl: { type: String, default: "" },

    // Plan snapshot
    planTierUsed: { type: String, default: "FREE" },
    includeIndividualReports: { type: Boolean, default: false },

    generatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export default mongoose.models.SessionReport ||
  mongoose.model("SessionReport", SessionReportSchema);
