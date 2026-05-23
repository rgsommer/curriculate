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

    // Last time a "we miss you, come back" nudge email was sent to
    // this lead.  Used to throttle the admin-triggered nudge so a
    // returning practicer never gets spammed more than once a week.
    lastNudgeAt: { type: Date, default: null },

    // First-touch conference follow-up.  Set once when the admin
    // tap-fires the conference-visitor introductory email.  Stays
    // set forever after — the button only ever sends to leads who
    // have NEVER been followed up.  Conference visitors get one
    // intro email; ongoing engagement is handled by the regular
    // nudge flow above.
    conferenceFollowupAt: { type: Date, default: null },

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

    // Append-only log of every "share /practice with a friend" tap.
    // Drives the daily-cap check on POST /recommend-practice (3
    // shares/day = +30 lifetime pts max), and gives the admin email a
    // simple "Friends invited: N" stat.  Capped to 200 entries.
    practiceShares: [
      {
        _id: false,
        channel: { type: String, default: "" }, // "share" | "sms" | "email" | "copy" | ...
        recipientHint: { type: String, default: "" }, // free-form, e.g. "Sam"
        points: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // Append-only feedback log: every task that the player rated or
    // commented on lands here, preserved across all replays.  Lives
    // outside `results` (which gets overwritten with each new session
    // because the per-session email shows only the latest run).  This
    // is what /feedback-export now reads, so historical comments aren't
    // wiped when the same email plays again.  Capped at 500 entries.
    feedbackEntries: [
      {
        _id: false,
        taskType: { type: String, default: "" },
        title: { type: String, default: "" },
        fun: { type: Number, default: 0 },
        clarity: { type: Number, default: 0 },
        confusing: { type: String, default: "" },
        suggestion: { type: String, default: "" },
        skipped: { type: Boolean, default: false },
        source: { type: String, default: "" }, // "rating" | "skip-dialog"
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // End-of-session "overall impression" ratings (1-5 stars each). Captured
    // once per finished practice session on the results screen. Append-only so
    // replays stack; capped to the last 100 entries.
    sessionRatings: [
      {
        _id: false,
        overall: { type: Number, min: 0, max: 5, default: 0 },          // overall impression of Curriculate
        wantTeacherUse: { type: Number, min: 0, max: 5, default: 0 },    // "I'd like my teacher to use this in class"
        recommend: { type: Number, min: 0, max: 5, default: 0 },         // "I'd likely recommend Curriculate"
        comment: { type: String, default: "" },
        source: { type: String, default: "" },                          // "conference" | "classroom" | "practice"
        createdAt: { type: Date, default: Date.now },
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
