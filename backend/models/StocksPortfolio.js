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
    // Sweep-account cash held within this brokerage account. Most Canadian
    // brokers (CIBC Investor's Edge, RBC Direct, TD Direct) keep separate
    // USD and CAD cash balances per account.
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
    // Trading currency — the exchange the stock trades on (USD or CAD).
    ccy: { type: String, enum: ["USD", "CAD"], required: true },
    // Settlement currency — which CURRENCY SUB-ACCOUNT actually holds the
    // position. Often equal to ccy, but a USD-listed stock CAN be held in the
    // CAD sub of an RRSP/TFSA (with FX friction on purchase and sale). When
    // null, assume same as ccy.
    subCcy: { type: String, enum: ["USD", "CAD", null], default: null },
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
    // Real-world trading-cost knobs the AI factors into trade sizing.
    // commissionPerTrade  — flat per-trade fee (CAD) at this user's broker
    //                       (CIBC Investor's Edge = $6.95; RBC Direct = $9.95).
    // fxSpreadPct         — round-trip FX spread when swapping USD↔CAD via
    //                       the broker's currency conversion (typically 1.5%).
    commissionPerTrade: { type: Number, default: 9.95 },
    fxSpreadPct: { type: Number, default: 1.5 },
    accounts: { type: [AccountSchema], default: [] },
    positions: { type: [PositionSchema], default: [] },
    // Planned withdrawals — "I need $X by date Y" so AI recs can prepare
    // cash and avoid locking it up in long-horizon buys.
    plannedWithdrawals: {
      type: [
        {
          id: { type: String, required: true },
          amount: { type: Number, required: true, min: 0 },
          currency: { type: String, enum: ["USD", "CAD"], required: true },
          targetDate: { type: Date, required: true },
          account: { type: String, default: "" },
          notes: { type: String, default: "", maxlength: 300 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      _id: false,
    },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const StocksPortfolio =
  mongoose.models.StocksPortfolio ||
  mongoose.model("StocksPortfolio", StocksPortfolioSchema);

export default StocksPortfolio;
