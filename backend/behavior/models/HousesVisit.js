// backend/behavior/models/HousesVisit.js
//
// Lightweight visit counter for the public House Standings portal (/houses).
// One document per school per (local) day; the portal fires a beacon once per
// browser tab session, which $inc's that day's `views`. Read back by the
// Curriculate admin dashboard to show how many people are checking standings.

import mongoose from "mongoose";

const HousesVisitSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true },
    // Local-midnight Date for the day these views fall on (range-queryable).
    day: { type: Date, required: true },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One row per school per day; the beacon upserts into it.
HousesVisitSchema.index({ schoolId: 1, day: 1 }, { unique: true });

export default mongoose.models.HousesVisit || mongoose.model("HousesVisit", HousesVisitSchema);
