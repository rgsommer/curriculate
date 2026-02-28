// models/AnonUsage.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const anonUsageSchema = new Schema(
  {
    anonId: { type: String, required: true, unique: true, index: true },

    gradingSubmissionsCount: { type: Number, default: 0 },
    gradingFirstSubmissionAt: { type: Date, default: null },
    gradingLastSubmissionAt: { type: Date, default: null },

    prompt5CompletedAt: { type: Date, default: null },
    prompt10CompletedAt: { type: Date, default: null },
    lastPromptShownAt: { type: Date, default: null },

    // ✅ when they later log in, attach
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AnonUsage", anonUsageSchema);