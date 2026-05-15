// backend/models/StocksTradeJournal.js
//
// Append-only log of every trade Richard records via the Stocks app.
// One document per trade (which may have 1 or 2 legs for a swap).
// Used for: history/attribution, cost-basis tracking, and comparing
// actual execution against the AI's recommendations on the Performance
// tab.

import mongoose from "mongoose";

const TradeLegSchema = new mongoose.Schema(
  {
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    ticker: { type: String, required: true, uppercase: true, trim: true },
    shares: { type: Number, required: true, min: 0 },
    pricePerShare: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ["USD", "CAD"], required: true },
    grossValue: { type: Number, required: true }, // shares * pricePerShare in `currency`
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
