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

    // AI summary (shape depends on your generator; store whole object)
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Parent note (print-ready)
    parentNote: { type: String, default: "" },

    // computed class aggregates
    classAverageScore: { type: Number, default: null },
    classAverageEngagement: { type: Number, default: null },

    // Noise sensor summary (class-level; not per-student)
    noiseSummary: { type: mongoose.Schema.Types.Mixed, default: null },

    // Details
    teams: { type: [TeamSchema], default: [] },
    attachments: { type: [AttachmentSchema], default: [] },

    // Optional: per-student stats (plan-gated in PDF rendering)
    perParticipant: { type: mongoose.Schema.Types.Mixed, default: null },

    // Plan snapshot
    planTierUsed: { type: String, default: "FREE" },
    includeIndividualReports: { type: Boolean, default: false },

    generatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export default mongoose.model("SessionReport", SessionReportSchema);
