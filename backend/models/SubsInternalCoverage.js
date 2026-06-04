// backend/models/SubsInternalCoverage.js
//
// Records internal coverage when no external sub is found (challenge #8):
// the admin pulls existing staff — splitting a class, covering it
// themselves, reassigning an EA, or using a prep period.
//
// Each record names the staff member pulled, so the system can count how
// often each person absorbs internal coverage and surface burnout risk /
// distribute load fairly (the dashboard aggregates by staffEmail/staffName).

import mongoose from "mongoose";

export const COVERAGE_TYPES = ["split-class", "admin", "ea-reassign", "prep-coverage", "other"];

const SubsInternalCoverageSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true, index: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsRequest", required: true, index: true },
    type: { type: String, enum: COVERAGE_TYPES, required: true },
    // The staff member who absorbed the coverage (free-form name + optional
    // email so load can be tallied per person).
    staffName: { type: String, required: true, trim: true },
    staffEmail: { type: String, default: "", lowercase: true, trim: true, index: true },
    note: { type: String, default: "" },
    createdByEmail: { type: String, default: "", lowercase: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.SubsInternalCoverage || mongoose.model("SubsInternalCoverage", SubsInternalCoverageSchema);
