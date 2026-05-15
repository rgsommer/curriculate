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
    totalCad: { type: Number, required: true },
    fxUsdCad: { type: Number, required: true },
    positionsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

StocksPortfolioSnapshotSchema.index({ email: 1, date: 1 }, { unique: true });

const StocksPortfolioSnapshot =
  mongoose.models.StocksPortfolioSnapshot ||
  mongoose.model("StocksPortfolioSnapshot", StocksPortfolioSnapshotSchema);

export default StocksPortfolioSnapshot;
