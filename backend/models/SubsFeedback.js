// backend/models/SubsFeedback.js
//
// Bug reports, suggestions, and auto-captured errors from the /subs
// substitute-staffing app. Mirrors GradingFeedback so feedback.py and the
// export endpoints treat all products uniformly — exported to
// feedback-subs.txt at the repo root.
//
// `kind: "error"` is for client-side failures reported automatically (a
// failed API call), distinct from teacher-submitted "problem"/"suggestion".

import mongoose from "mongoose";

const SubsFeedbackSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["problem", "suggestion", "error"], default: "suggestion", index: true },
    message: { type: String, required: true },
    fromName: { type: String, default: "" },
    fromEmail: { type: String, default: "", lowercase: true },
    // Where in the app it came from (e.g. "admin/post-request", "teacher/offers").
    surface: { type: String, default: "" },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["open", "in_progress", "fixed", "wontfix"], default: "open", index: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

SubsFeedbackSchema.index({ createdAt: -1 });

export default mongoose.models.SubsFeedback || mongoose.model("SubsFeedback", SubsFeedbackSchema, "subs_feedback");
