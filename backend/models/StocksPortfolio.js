// backend/models/StocksPortfolio.js
//
// One document per email. Holds the user's risk tolerance, accounts,
// positions, and FX assumption for the personal stock advisor at /stocks.
//
// Auth is via HMAC session token issued by the frontend's
// /api/stocks/verify-pin route. See backend/routes/stocksPortfolio.js
// for the verification logic.

import mongoose from "mongoose";

const AccountSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    // Sweep-account cash held within this brokerage account. RBC Direct and
    // similar brokerages keep a separate USD and CAD cash balance per account.
    cashUsd: { type: Number, default: 0 },
    cashCad: { type: Number, default: 0 },
  },
  { _id: false }
);

const PositionSchema = new mongoose.Schema(
  {
    acct: { type: String, required: true }, // account.id
    ticker: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, default: "" },
    qty: { type: Number, required: true },
    ccy: { type: String, enum: ["USD", "CAD"], required: true },
    priceUsd: { type: Number, default: null },
    priceCad: { type: Number, default: null },
    costBasisUsd: { type: Number, default: null },
    costBasisCad: { type: Number, default: null },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const StocksPortfolioSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    riskTolerance: {
      type: String,
      enum: ["conservative", "moderate", "aggressive", "speculative"],
      default: null,
    },
    fxUsdCad: { type: Number, default: 1.37 },
    accounts: { type: [AccountSchema], default: [] },
    positions: { type: [PositionSchema], default: [] },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const StocksPortfolio =
  mongoose.models.StocksPortfolio ||
  mongoose.model("StocksPortfolio", StocksPortfolioSchema);

export default StocksPortfolio;
