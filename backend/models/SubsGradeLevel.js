// backend/models/SubsGradeLevel.js
//
// A grade level within a school (e.g. "Grade 3", "Kindergarten", "Music").
// Substitute preference rankings are scoped per grade level — a school
// ranks its preferred subs differently for early-years vs senior grades.

import mongoose from "mongoose";

const SubsGradeLevelSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Display order within the school's grade list.
    order: { type: Number, default: 0 },
    // The "appropriate VP" for this grade/division — overrides the school
    // default VP for lesson-plan handoff when a sub is found. Falls back to
    // SubsSchool.vpEmail when empty.
    vpEmail: { type: String, default: "", lowercase: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.SubsGradeLevel || mongoose.model("SubsGradeLevel", SubsGradeLevelSchema);
