// backend/models/PulseBetaTester.js
// Free 1-year beta subscription for Pulse Grading — teachers who commit to
// trying the tool at least once a month and giving feedback in exchange for
// full Plus-tier access before (and beyond) the paid freemium activation.
//
// A beta code is single-use to create the record; after that it acts as a
// long-lived license key the client presents on every grading request via
// meta.betaCode. checkFreemiumGate honors it as PLUS.

import mongoose from "mongoose";

const PulseBetaTesterSchema = new mongoose.Schema(
  {
    // Human-shareable license key. Format: "PULSE-BETA-XXXXXX" where XXXXXX
    // is 6 chars of uppercase alphanumerics avoiding easily-confused pairs
    // (no I/1/O/0). Uniqueness enforced at index level. Set at creation.
    betaCode: { type: String, required: true, unique: true, index: true },

    // Contact info the teacher provides on signup.
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, trim: true },
    school: { type: String, trim: true },
    role: { type: String, trim: true }, // "teacher" | "admin" | "specialist" | "other"
    subjectArea: { type: String, trim: true }, // free text — english, math, music, etc.
    gradeBand: { type: String, trim: true }, // "3-5" | "6-8" | "9-10" | "11+" | "K-2" | "mixed"
    whyInterested: { type: String, trim: true, maxlength: 2000 },

    // Lifecycle timestamps.
    signedUpAt: { type: Date, default: Date.now, index: true },
    activatedAt: { type: Date }, // set the first time the code is used on /grading
    expiresAt: { type: Date, required: true, index: true }, // signedUpAt + 365 days

    // Usage bookkeeping — we ask beta users to try monthly, so track grades
    // per calendar month + a running total. Used by the reminder scheme.
    gradesTotal: { type: Number, default: 0 },
    gradesThisMonth: { type: Number, default: 0 },
    monthAnchor: { type: String, default: "" }, // "YYYY-MM" — when this resets
    lastGradedAt: { type: Date },

    // Reminder / feedback bookkeeping.
    remindersEnabled: { type: Boolean, default: true },
    lastReminderSentAt: { type: Date },
    feedbackCount: { type: Number, default: 0 },
    lastFeedbackAt: { type: Date },

    // Revocation. If we ever need to yank a beta tester for abuse.
    revokedAt: { type: Date },
    revokedReason: { type: String, trim: true },

    // Signup metadata (source page, user agent) for lightweight analytics.
    signupSource: { type: String, trim: true, default: "pulse-landing" },
    userAgent: { type: String, trim: true },
    ip: { type: String, trim: true },
  },
  { versionKey: false, timestamps: false }
);

// One active beta per email — a teacher shouldn't stack multiple 1-year codes.
// Partial index skips revoked records so a re-signup after revocation is
// possible if we choose to allow it later.
PulseBetaTesterSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { revokedAt: null } }
);

export default mongoose.models.PulseBetaTester
  || mongoose.model("PulseBetaTester", PulseBetaTesterSchema);
