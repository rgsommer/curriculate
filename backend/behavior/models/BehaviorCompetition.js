// backend/behavior/models/BehaviorCompetition.js
//
// A monthly house competition (Sept–June calendar): quiz, kindness marathon,
// choir/food drive, mini-Olympics, STEM day, spirit week, etc. When an event is
// scored, the placing houses earn capped placement points (1st 500 / 2nd 300 /
// 3rd 200 / 4th 100 by default) that layer ON TOP of everyday behaviour points —
// big enough to matter, capped so a single event can't run away with the year.
//
// Awards are written as HousePointEvents tagged with this competition's id, so
// re-scoring is idempotent (delete-then-reaward) and the house leaderboard total
// (the sum of all HousePointEvents) just works.

import mongoose from "mongoose";

const ResultSchema = new mongoose.Schema(
  { houseId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorHouse" }, place: { type: Number } },
  { _id: false }
);

const BehaviorCompetitionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // 0 = September … 9 = June (the JH school year), for calendar ordering.
    monthOrder: { type: Number, default: 0, index: true },
    monthLabel: { type: String, default: "" }, // e.g. "September"
    // Points for 1st, 2nd, 3rd, 4th… place. Capped so one event can't dominate.
    placementPoints: { type: [Number], default: [500, 300, 200, 100] },
    // Set once scored: which house took which place.
    results: { type: [ResultSchema], default: [] },
    scoredAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorCompetition || mongoose.model("BehaviorCompetition", BehaviorCompetitionSchema);
