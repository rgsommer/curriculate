// backend/models/GradingUsage.js

import mongoose from "mongoose";

const GradingUsageSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },

    sessionId: { type: String, index: true },
    ip: String,

    location: {
      country: String,
      region: String,
      city: String,
    },

    subject: String,
    assessmentType: String,
    gradeLevel: String,

    // How the work was submitted: "photo" | "paste" | "batch" | "video" | "audio" | "upload"
    // Previously written but silently dropped by strict mode — admin's input-mode chart
    // showed every doc as "photo" because the field never persisted.
    inputMode: { type: String, index: true },

    // Which Curriculate product generated the submission:
    //   "pulse-grading"   — Pulse Grading at curriculate.net/grading (default)
    //   "curriculate"     — live Curriculate scavenger-hunt sessions (server-graded)
    //   "fieldday"        — FieldDay (planned)
    // Captured from req.body.meta.appName, falling back to a heuristic on Origin/Referer
    // when the client doesn't supply it.
    appName: { type: String, index: true },

    imageCount: Number,
    rubricOverrideUsed: Boolean,
    responseTimeMs: Number,

    refCode: String,
    userAgent: String,
  },
  { versionKey: false }
);

export default mongoose.models.GradingUsage ||
  mongoose.model("GradingUsage", GradingUsageSchema);
