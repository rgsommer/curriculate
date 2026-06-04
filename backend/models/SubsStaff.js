// backend/models/SubsStaff.js
//
// A regular (non-substitute) staff teacher on a school's roster — the
// people who get covered when absent, distinct from the substitute pool.
//
// The roster builds itself: when a principal approves a teacher-submitted
// absence request, the requesting teacher is upserted here automatically
// (auto-roster), so principals don't have to maintain the list up front.
// They can also add staff manually. The email is the identity used for the
// "your class is covered — send lesson plans" notification.

import mongoose from "mongoose";

const SubsStaffSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "", trim: true },
    // The grade/class they usually teach (optional).
    gradeLevelId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsGradeLevel", default: null },
    // True when the record was created by approving their own request.
    viaApproval: { type: Boolean, default: false },
    // Remembered requirements for this teacher's class, so posting a sub
    // request for them pre-fills what's usually needed.
    defaultRole: { type: String, default: "" },
    defaultRequiredQualifications: { type: [String], default: [] },
  },
  { timestamps: true }
);

SubsStaffSchema.index({ schoolId: 1, email: 1 }, { unique: true });

export default mongoose.models.SubsStaff || mongoose.model("SubsStaff", SubsStaffSchema);
