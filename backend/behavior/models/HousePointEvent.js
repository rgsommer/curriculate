// backend/behavior/models/HousePointEvent.js
//
// An append-only points transaction for the house system. Positive points are
// teacher awards (to a student or a whole house); negative points come from
// incidents (behaviour.points). The house total is the sum of these.

import mongoose from "mongoose";

const HousePointEventSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    houseId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorHouse", required: true, index: true },
    // Set when the points are tied to a particular student; null for a
    // whole-house award.
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", default: null, index: true },
    points: { type: Number, required: true }, // + award, − deduction
    reason: { type: String, default: "" },
    // Set when this deduction came from a logged incident.
    behaviorId: { type: mongoose.Schema.Types.ObjectId, ref: "Behavior", default: null },
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorIncident", default: null },
    // Set when these points came from a scored house competition (placement
    // points), so re-scoring can delete-then-reaward idempotently.
    competitionId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorCompetition", default: null, index: true },
    awardedByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null },
    at: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

HousePointEventSchema.index({ schoolId: 1, houseId: 1, at: -1 });

export default mongoose.models.HousePointEvent || mongoose.model("HousePointEvent", HousePointEventSchema);
