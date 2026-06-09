// backend/behavior/models/BehaviorHouse.js
//
// A school "house" (e.g. for a house-points system). Students are assigned to a
// house (BehaviorStudent.houseId); points are awarded/deducted via
// HousePointEvent and totalled per house.

import mongoose from "mongoose";

const BehaviorHouseSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#0f172a" }, // hex for chips/leaderboard
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorHouse || mongoose.model("BehaviorHouse", BehaviorHouseSchema);
