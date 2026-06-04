// backend/models/SubsReliabilityFeedback.js
//
// Private, post-assignment admin feedback on a sub (challenge #9, #10).
// Ratings + tags feed the sub's aggregated reliability profile, which in
// turn informs (but does not blindly dictate) ranking suggestions. Notes
// are private to the school's admins.

import mongoose from "mongoose";

const SubsReliabilityFeedbackSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsTeacher", required: true, index: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true, index: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsRequest", default: null },
    rating: { type: Number, min: 1, max: 5, required: true },
    onTime: { type: Boolean, default: null },
    canTeach: { type: Boolean, default: null }, // genuinely taught vs supervised only (#10)
    tags: { type: [String], default: [] },
    note: { type: String, default: "" }, // private to admins
    createdByEmail: { type: String, default: "", lowercase: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.SubsReliabilityFeedback || mongoose.model("SubsReliabilityFeedback", SubsReliabilityFeedbackSchema);
