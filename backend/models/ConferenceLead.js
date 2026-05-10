// backend/models/ConferenceLead.js
import mongoose from "mongoose";

const conferenceLeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, index: true },
    role: { type: String, default: "" }, // e.g. "Teacher", "Admin", "Student", "Other"
    conference: { type: String, default: "general" }, // which conference/event
    source: { type: String, default: "conference" }, // "conference" | "classroom"
    classroom: { type: String, default: "" }, // teacher-defined class label (e.g. "Period 3 Science")
    registeredAt: { type: Date, default: Date.now },
    // Lifetime, cumulative across every practice session this email has
    // played (within a given conference).  Drives the leaderboard.
    totalPoints: { type: Number, default: 0 },
    // How many times this lead has finished a session (incremented on
    // every POST /api/conference/results).  Lets the email say
    // "session #3" and lets us spot returning practicers.
    sessionCount: { type: Number, default: 0 },
    // Cumulative count of every task this lead has played (skipped or
    // not), across every session.  `results` only holds the *latest*
    // session so the email's task table stays focused; this counter
    // preserves the lifetime stat the /activity admin view used to read
    // off `results.length`.
    lifetimeTaskCount: { type: Number, default: 0 },
    lifetimeCompletedCount: { type: Number, default: 0 },

    // Trail of recent session subtotals so the admin notification can
    // compute a "this week" leaderboard (top 3 → weekly gift card).
    // Capped to the last 30 entries via $push $slice on insert; that's
    // ~7 months of weekly play before anything ages out.
    sessions: [
      {
        _id: false,
        points: { type: Number, default: 0 },
        completedAt: { type: Date, default: Date.now },
        completedCount: { type: Number, default: 0 },
        taskCount: { type: Number, default: 0 },
      },
    ],

    // Task results captured during demo play
    results: [
      {
        taskType: String,
        title: String,
        answer: mongoose.Schema.Types.Mixed,
        skipped: { type: Boolean, default: false },
        points: { type: Number, default: 0 },
        feedback: {
          fun: { type: Number, min: 0, max: 5, default: 0 },
          clarity: { type: Number, min: 0, max: 5, default: 0 },
          confusing: { type: String, default: "" },
          suggestion: { type: String, default: "" },
        },
        completedAt: Date,
      },
    ],
    resultsSentAt: { type: Date, default: null },

    // Promo code tracking
    promoCode: { type: String, default: "CONFERENCE2025" },
    promoRedeemed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Allow multiple visits from the same email (different conferences)
conferenceLeadSchema.index({ email: 1, conference: 1 });

const ConferenceLead =
  mongoose.models.ConferenceLead ||
  mongoose.model("ConferenceLead", conferenceLeadSchema);

export default ConferenceLead;
