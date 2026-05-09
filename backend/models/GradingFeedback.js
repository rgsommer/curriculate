// backend/models/GradingFeedback.js
//
// Pulse Grading bug-reports + suggestions from teachers. Mirrors the
// shape of the Field Day Feedback subschema (in backend/fieldday/models.js)
// so feedback.py and the export endpoints can treat them uniformly.
//
// Difference from FeedbackMessage.js: that one is the per-student
// scavenger-hunt session feedback (rating, taught-back text). This one
// is teacher-facing app feedback about Pulse Grading itself.

import mongoose from "mongoose";

const GradingFeedbackSchema = new mongoose.Schema(
  {
    kind:       { type: String, enum: ["problem", "suggestion"], default: "suggestion", index: true },
    message:    { type: String, required: true },
    fromName:   { type: String, default: "" },
    fromEmail:  { type: String, default: "", lowercase: true },
    // Where the teacher was when they hit Report — gives us context like
    // "from photo grading" vs "from batch grading" vs "from rubric upload".
    surface:    { type: String, default: "" },
    context:    { type: mongoose.Schema.Types.Mixed, default: {} },
    // Triage state — distinguishes open / fixed so the cleanup path can
    // delete only resolved items by default.
    status:     { type: String, enum: ["open", "in_progress", "fixed", "wontfix"], default: "open", index: true },
    notes:      { type: String, default: "" }
  },
  { timestamps: true }
);

GradingFeedbackSchema.index({ createdAt: -1 });

export default mongoose.models.GradingFeedback ||
  mongoose.model("GradingFeedback", GradingFeedbackSchema, "grading_feedback");
