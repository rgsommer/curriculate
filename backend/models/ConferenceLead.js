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
    totalPoints: { type: Number, default: 0 },

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
