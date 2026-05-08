// backend/models/StudentScavengerProgress.js
//
// Per-student running totals for Curriculate scavenger hunts. Keyed by
// (teacherEmail + edsbyId) so the same student under different teachers
// keeps separate ledgers. Written at session-report time when the
// student joined a class-bound session and picked themselves from the
// roster (so we have a stable edsbyId to attribute points to).
//
// This is a lightweight stats record — not a full session log. The full
// per-session record lives in SessionReport.

import mongoose from "mongoose";

const StudentScavengerProgressSchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true, index: true },
    edsbyId: { type: String, required: true, index: true },
    studentId: { type: String, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    className: { type: String, default: "" },

    // Running totals
    totalSessions: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },

    // Streak: consecutive school days with at least one completed session.
    // Updated on each session-report write — see updateStreak() in the writer.
    streakDays: { type: Number, default: 0 },
    longestStreakDays: { type: Number, default: 0 },

    // Timestamps
    firstPlayedAt: { type: Date, default: null },
    lastPlayedAt: { type: Date, default: null },

    // Per-session ledger (capped at last 10) — used to compute the
    // improvement / trend indicator on the next session report.
    recentSessions: {
      type: [
        new mongoose.Schema(
          {
            roomCode: { type: String, default: "" },
            taskSetName: { type: String, default: "" },
            percent: { type: Number, default: 0 },
            pointsEarned: { type: Number, default: 0 },
            pointsPossible: { type: Number, default: 0 },
            completedAt: { type: Date, default: () => new Date() },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Compound index — typical lookup is by teacherEmail+edsbyId together.
StudentScavengerProgressSchema.index(
  { teacherEmail: 1, edsbyId: 1 },
  { unique: true }
);

const StudentScavengerProgress =
  mongoose.models.StudentScavengerProgress ||
  mongoose.model("StudentScavengerProgress", StudentScavengerProgressSchema);

export default StudentScavengerProgress;
