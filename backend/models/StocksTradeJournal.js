// backend/models/StocksTradeJournal.js
//
// Append-only log of every trade Richard records via the Stocks app.
// One document per trade (which may have 1 or 2 legs for a swap).
// Used for: history/attribution, cost-basis tracking, and comparing
// actual execution against the AI's recommendations on the Performance
// tab.

import mongoose from "mongoose";

// A leg can be one of:
//   BUY / SELL      — equity trade. ticker + shares + pricePerShare required.
//   DEPOSIT         — cash added to the account. Only `amount` + `currency`.
//   WITHDRAW        — cash removed from the account. Only `amount` + `currency`.
// `grossValue` is the abs CAD-or-USD value of the leg in its native currency.
const TradeLegSchema = new mongoose.Schema(
  {
    side: { type: String, enum: ["BUY", "SELL", "DEPOSIT", "WITHDRAW"], required: true },
    ticker: { type: String, uppercase: true, trim: true, default: null },
    shares: { type: Number, min: 0, default: null },
    pricePerShare: { type: Number, min: 0, default: null },
    currency: { type: String, enum: ["USD", "CAD"], required: true },
    grossValue: { type: Number, required: true }, // value of the leg in `currency`
  },
  { _id: false }
);

const StocksTradeJournalSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    executedAt: { type: Date, required: true, default: Date.now, index: true },
    account: { type: String, default: "" }, // account.id from portfolio
    accountName: { type: String, default: "" }, // denormalized for display
    legs: { type: [TradeLegSchema], required: true, validate: (v) => v.length >= 1 && v.length <= 4 },

    // Net CAD impact: positive = trade brought cash IN (more sold than bought),
    // negative = trade used cash. Computed from legs + FX at trade time.
    netCashCad: { type: Number, default: 0 },
    fxUsdCadAtTrade: { type: Number, default: 1.37 },

    notes: { type: String, default: "", maxlength: 500 },

    // Optional link to the recommendation this trade fulfilled (if any)
    linkedAdviceRecId: { type: mongoose.Schema.Types.ObjectId, ref: "StocksAdviceRec", default: null },
  },
  { timestamps: true }
);

const StocksTradeJournal =
  mongoose.models.StocksTradeJournal ||
  mongoose.model("StocksTradeJournal", StocksTradeJournalSchema);

export default StocksTradeJournal;
