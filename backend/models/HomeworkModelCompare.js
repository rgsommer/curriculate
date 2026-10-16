// backend/models/HomeworkModelCompare.js
//
// Side-by-side model test for the homework check: for each student, the SAME
// request the live model marked is re-run on a cheaper candidate model in the
// background. Only the live result is ever used; this records both (plus token
// usage) so the two can be compared question by question before switching.

import mongoose from "mongoose";

const HomeworkModelCompareSchema = new mongoose.Schema(
  {
    at: { type: Date, default: () => new Date(), index: true },
    teacherEmail: { type: String, default: "" },
    className: { type: String, default: "" },
    lessonCode: { type: String, default: "" },
    student: { type: String, default: "" },
    pages: { type: Number, default: 0 },
    hasAnswerKey: { type: Boolean, default: false },
    primaryModel: { type: String, default: "" },
    shadowModel: { type: String, default: "" },
    primary: { type: mongoose.Schema.Types.Mixed, default: null }, // parsed JSON the live model returned
    shadow: { type: mongoose.Schema.Types.Mixed, default: null },  // parsed JSON the candidate returned
    shadowError: { type: String, default: "" },
    usagePrimary: { type: mongoose.Schema.Types.Mixed, default: null },
    usageShadow: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: false }
);

export default mongoose.models.HomeworkModelCompare || mongoose.model("HomeworkModelCompare", HomeworkModelCompareSchema);
