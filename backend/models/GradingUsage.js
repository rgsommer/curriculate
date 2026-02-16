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
