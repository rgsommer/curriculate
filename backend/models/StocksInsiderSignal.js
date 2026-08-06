// backend/models/StocksInsiderSignal.js
//
// Computed cluster signals detected by the insider-sync job. One doc per
// (ticker, kind, detectedAt) — a fresh cluster on the same ticker N days
// later gets its own row so the timeline is preserved.
//
// A "cluster" is a 30-day rolling window of same-direction insider
// transactions that clears a role-weighted score threshold. See
// services/stocksInsiderSignals.js for the exact heuristic.

import mongoose from "mongoose";

const StocksInsiderSignalSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, uppercase: true, index: true },
    kind: {
      type: String,
      enum: ["cluster_buy", "cluster_sell"],
      required: true,
    },
    // Role-weighted strength score. Buys ≥ 5 emit; sells ≥ 8.
    strength: { type: Number, required: true },
    uniqueInsiderCount: { type: Number, default: 0 },
    execCount: { type: Number, default: 0 }, // CEO/CFO/COO/CTO
    directorCount: { type: Number, default: 0 },
    tenPctCount: { type: Number, default: 0 },
    windowDays: { type: Number, default: 30 },
    // Names / roles / share counts of contributors, capped at 10.
    insiders: {
      type: [
        new mongoose.Schema(
          {
            name: String,
            role: String,
            shares: Number,
            avgPrice: Number,
            totalValueUsd: Number,
            transactionDates: [Date],
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    totalSharesTraded: { type: Number, default: 0 },
    totalValueUsd: { type: Number, default: 0 },
    avgPricePerShare: { type: Number, default: null },
    detectedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// One signal per (ticker, kind, YYYY-MM-DD of detection) so re-running the
// job the same day doesn't duplicate — a fresh cluster the NEXT day gets
// its own row. detectedAt is stored as a date so we index by day.
StocksInsiderSignalSchema.index({ ticker: 1, kind: 1, detectedAt: -1 });

export default mongoose.models.StocksInsiderSignal
  || mongoose.model("StocksInsiderSignal", StocksInsiderSignalSchema);
