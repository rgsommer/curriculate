// backend/models/StocksPortfolioSnapshot.js
//
// Time-series of portfolio total value (CAD) per email.
// One snapshot per UTC day (latest write wins for same day).
// Used to render performance over week/month/3M/1Y windows.

import mongoose from "mongoose";

const StocksPortfolioSnapshotSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    date: { type: String, required: true }, // YYYY-MM-DD UTC
    // Per-account dimension: an account's id, or "__total__" for the aggregate row.
    // Older rows that predate this field are treated as aggregate.
    accountId: { type: String, default: "__total__", required: true },
    totalCad: { type: Number, required: true },        // equity+cash in CAD
    equitiesCad: { type: Number, default: 0 },
    cashCad: { type: Number, default: 0 },
    cashUsd: { type: Number, default: 0 },
    fxUsdCad: { type: Number, required: true },
    positionsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One row per (email, date, accountId). Aggregate row uses accountId="__total__".
StocksPortfolioSnapshotSchema.index({ email: 1, date: 1, accountId: 1 }, { unique: true });

const StocksPortfolioSnapshot =
  mongoose.models.StocksPortfolioSnapshot ||
  mongoose.model("StocksPortfolioSnapshot", StocksPortfolioSnapshotSchema);

export default StocksPortfolioSnapshot;
