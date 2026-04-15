// backend/models/StudentProfile.js
// ====================================================================
//  Lightweight student identity keyed by email (no password/login).
//  Tracks cumulative participation across sessions for streak-based
//  skin unlocks. Created automatically when a student provides their
//  email at join time.
// ====================================================================
import mongoose from "mongoose";

const { Schema } = mongoose;

const studentProfileSchema = new Schema(
  {
    // Normalized lowercase email — the unique identity key
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    // Last display name used (for convenience in reports/UI)
    displayName: { type: String, default: "" },

    // ── Cumulative stats ──
    sessionsPlayed: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },

    // ── Streak tracking ──
    // A "session day" = calendar date of a session. Playing twice on the
    // same day counts as 1 toward the streak. A streak breaks if the
    // student misses 14+ days between sessions (generous for school
    // schedules — covers weekends, holidays, sick days).
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastSessionDate: { type: Date, default: null },

    // ── Unlocks ──
    // Array of skin keys the student has earned (e.g. "border-gold",
    // "celebration-confetti", "avatar-astronaut"). Populated automatically
    // when cumulative thresholds are crossed.
    unlockedSkins: { type: [String], default: [] },

    // Currently equipped skin (must be in unlockedSkins or null for default)
    activeSkin: { type: String, default: null },

    // ── Session history (lightweight) ──
    // Last N session references for the student's "history" view.
    // Capped at 50 entries to keep the document small.
    recentSessions: {
      type: [
        {
          roomCode: String,
          className: String,
          taskSetName: String,
          teamName: String,
          pointsEarned: Number,
          tasksCompleted: Number,
          playedAt: Date,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Cap recentSessions to 50 entries on save
studentProfileSchema.pre("save", function (next) {
  if (this.recentSessions && this.recentSessions.length > 50) {
    this.recentSessions = this.recentSessions.slice(-50);
  }
  next();
});

const StudentProfile = mongoose.model("StudentProfile", studentProfileSchema);
export default StudentProfile;
