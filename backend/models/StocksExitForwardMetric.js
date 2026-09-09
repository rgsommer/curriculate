// StocksExitForwardMetric
//
// P3 (2026-09-09) — per-exit forward-return measurement.
// For every SELL/TRIM/EXIT decision we snapshot the exit price and,
// after each horizon elapses (1d, 5d, 10d, 20d, 60d), a backfill job
// fills in the actual forward return and the benchmark-matched
// forward return. Only after all five horizons complete can we
// classify the exit as GOOD / NEUTRAL / PREMATURE / LATE.
//
// One row per (email, ticker, exitDate, brokerRef). Idempotent.

import mongoose from "mongoose";

const HorizonSchema = new mongoose.Schema(
  {
    horizonDays: { type: Number, required: true },
    filledAt: { type: Date, default: null },
    forwardPricePeriod: { type: Number, default: null },
    forwardReturnPct: { type: Number, default: null },
    benchmarkForwardReturnPct: { type: Number, default: null },
    exitAlphaPct: { type: Number, default: null },      // security minus benchmark
    status: { type: String, enum: ["PENDING", "FILLED", "MISSING_DATA"], default: "PENDING" },
  },
  { _id: false }
);

const ExitForwardSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    ticker: { type: String, required: true, index: true },
    account: { type: String, default: null },
    sleeve: { type: String, default: null, index: true },
    exitDate: { type: Date, required: true, index: true },
    exitPrice: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    benchmarkTicker: { type: String, default: null },
    exitTradeRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    exitAction: { type: String, default: null }, // SELL | TRIM | EXIT

    horizons: { type: [HorizonSchema], default: [] },
    classification: {
      type: String,
      enum: ["PENDING", "GOOD_EXIT", "NEUTRAL", "PREMATURE_EXIT", "LATE_EXIT"],
      default: "PENDING",
      index: true,
    },
    // Filled when all horizons are done AND the classification rule
    // fires. Kept null until then so a premature dashboard read
    // shows PENDING rather than a half-baked verdict.
    classifiedAt: { type: Date, default: null },
    lastBackfillAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ExitForwardSchema.index({ email: 1, ticker: 1, exitDate: 1, exitTradeRef: 1 }, { unique: true, sparse: true });

const StocksExitForwardMetric = mongoose.model("StocksExitForwardMetric", ExitForwardSchema);
export default StocksExitForwardMetric;
