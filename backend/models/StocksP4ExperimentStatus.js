// StocksP4ExperimentStatus
//
// P4.1 (2026-09-11) — mutable status annotation on a frozen experiment.
// Separate collection so StocksP4Experiment can stay truly write-once.
//
// One row per experimentId. status transitions:
//   VALID          — accumulating forward evidence
//   PILOT_INVALID  — infrastructure worked but observations must be
//                    EXCLUDED from leaderboards / promotion / alpha
//                    stats / evidence card
//   ARCHIVED       — retired for other reasons
//
// Leaderboard + promotion queries JOIN on this collection and filter
// out anything not VALID.

import mongoose from "mongoose";

const Schema = new mongoose.Schema(
  {
    experimentId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["VALID", "PILOT_INVALID", "ARCHIVED"],
      default: "VALID",
      index: true,
    },
    invalidationReason: { type: String, default: null },
    markedAt: { type: Date, default: Date.now },
    markedBy: { type: String, default: "system" },
    history: {
      type: [{ status: String, reason: String, at: Date, by: String }],
      default: [],
    },
  },
  { timestamps: true }
);

const StocksP4ExperimentStatus = mongoose.model("StocksP4ExperimentStatus", Schema);
export default StocksP4ExperimentStatus;
