// backend/behavior/models/MerchRedemption.js
//
// A student spending personal (positive) points on a merch item. This is a
// SEPARATE ledger from HousePointEvent: it debits the student's personal wallet
// (earned positives − redemptions) but never touches house standings. Recorded
// by staff when a student collects an item.

import mongoose from "mongoose";

const MerchRedemptionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", required: true, index: true },
    item: { type: String, default: "" },
    points: { type: Number, required: true }, // points spent (positive number)
    byTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null },
    byName: { type: String, default: "" },
    at: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

MerchRedemptionSchema.index({ schoolId: 1, studentId: 1, at: -1 });

export default mongoose.models.MerchRedemption || mongoose.model("MerchRedemption", MerchRedemptionSchema);
