// StocksP4ChampionState
//
// P4 (2026-09-11) — champion / challenger state machine per model.
// Production traffic is still routed via CHAMPION_MODEL_ID; this
// collection is diagnostic + audit only. A challenger becomes
// PROMOTION_ELIGIBLE when all preregistered criteria are met AND the
// user has approved (spec §17).
//
// States:
//   INCUMBENT           — currently in production
//   CHALLENGER          — running in shadow
//   PROMOTION_ELIGIBLE  — met all preregistered thresholds
//   PROMOTED            — approved by user; became INCUMBENT of a
//                         NEW experiment (never mutated the frozen
//                         experiment in which it earned promotion)
//   RETIRED             — challenger explicitly stood down

import mongoose from "mongoose";

const Schema = new mongoose.Schema(
  {
    experimentId: { type: String, required: true, index: true },
    modelId: { type: String, required: true, index: true },
    state: {
      type: String,
      // P4.1: CONTROL is Model G (passive). CONTROLs are never
      // evaluated for promotion. INCUMBENT is Model A (production).
      enum: ["INCUMBENT", "CHALLENGER", "CONTROL", "PROMOTION_ELIGIBLE", "PROMOTED", "RETIRED"],
      default: "CHALLENGER",
      index: true,
    },
    evidenceSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    promotedAt: { type: Date, default: null },
    promotedBy: { type: String, default: null },
    retiredAt: { type: Date, default: null },
    retiredReason: { type: String, default: null },
    lastEvaluatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

Schema.index({ experimentId: 1, modelId: 1 }, { unique: true });

const StocksP4ChampionState = mongoose.model("StocksP4ChampionState", Schema);
export default StocksP4ChampionState;
