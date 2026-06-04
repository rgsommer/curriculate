// backend/models/SubsRanking.js
//
// The ordered list of preferred substitute teachers for one (school,
// gradeLevel) pair. `entries` is sorted by `rank` ascending — rank 0 is
// contacted first, then 1, then 2, and so on as the engine escalates.
//
// One ranking document per (schoolId, gradeLevelId); the unique compound
// index enforces that.

import mongoose from "mongoose";

const SubsRankingEntrySchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsTeacher", required: true },
    rank: { type: Number, required: true },
  },
  { _id: false }
);

const SubsRankingSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true },
    gradeLevelId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsGradeLevel", required: true },
    entries: { type: [SubsRankingEntrySchema], default: [] },
  },
  { timestamps: true }
);

SubsRankingSchema.index({ schoolId: 1, gradeLevelId: 1 }, { unique: true });

export default mongoose.models.SubsRanking || mongoose.model("SubsRanking", SubsRankingSchema);
