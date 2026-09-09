// StocksDailyPositionSnapshot
//
// P3.5 (2026-09-09) — per-ticker daily snapshot for forward-only exact
// history. Enables clean walk-forward attribution starting today.
//
// One row per (email, date, account, ticker). Idempotent.

import mongoose from "mongoose";

const Schema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    account: { type: String, default: null, index: true },
    ticker: { type: String, required: true, index: true },
    shares: { type: Number, default: null },
    priceNative: { type: Number, default: null },
    currency: { type: String, default: null },
    fxUsdCad: { type: Number, default: null },
    marketValueCad: { type: Number, default: null },
    costBasisNative: { type: Number, default: null },
    sleeve: { type: String, default: null },
    sector: { type: String, default: null },
    industry: { type: String, default: null },
    linkedRecommendationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    pickEngineVersion: { type: String, default: null },
    decisionEngineVersion: { type: String, default: null },
  },
  { timestamps: true }
);

Schema.index({ email: 1, date: 1, account: 1, ticker: 1 }, { unique: true });

const StocksDailyPositionSnapshot = mongoose.model("StocksDailyPositionSnapshot", Schema);
export default StocksDailyPositionSnapshot;
