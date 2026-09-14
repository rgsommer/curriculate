// StocksP4Outcome
//
// P4 (2026-09-11) — forward-horizon outcomes attached to a pick
// record. Populated by the outcome cron once each horizon matures.
// PENDING until then — never fabricate.
//
// One outcome row per pick record. Horizons is an array of
// {horizonDays, rawReturnPct, benchmarkReturnPct, alphaPp, mfePct,
//  maePct, status} entries so a single row carries the full life-
// cycle of the pick.

import mongoose from "mongoose";

const HorizonEntry = new mongoose.Schema({
  horizonDays: { type: Number, required: true },
  status: {
    type: String,
    enum: ["PENDING", "FILLED", "MISSING_DATA"],
    default: "PENDING",
  },
  observedAt: { type: Date, default: null },
  rawReturnPct: { type: Number, default: null },
  cadReturnPct: { type: Number, default: null },
  benchmarkReturnPct: { type: Number, default: null },
  alphaPp: { type: Number, default: null },
  mfePct: { type: Number, default: null },
  maePct: { type: Number, default: null },
  maxDrawdownPct: { type: Number, default: null },
  upsideCapture: { type: Number, default: null },
  downsideCapture: { type: Number, default: null },
}, { _id: false });

const Schema = new mongoose.Schema(
  {
    experimentId: { type: String, required: true, index: true },
    pickDate: { type: String, required: true, index: true },
    model: { type: String, required: true, index: true },
    funnel: { type: String, default: "NARROW" },
    ticker: { type: String, required: true, index: true },

    referencePrice: { type: Number, required: true },
    benchmark: { type: String, default: null },

    horizons: { type: [HorizonEntry], default: () => [] },

    // Rollups for common horizons — nulls until the horizon matures.
    matureHorizonsCompleted: { type: [Number], default: [] },
    lastComputedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

Schema.index(
  { experimentId: 1, pickDate: 1, model: 1, funnel: 1, ticker: 1 },
  { unique: true }
);

const StocksP4Outcome = mongoose.model("StocksP4Outcome", Schema);
export default StocksP4Outcome;
