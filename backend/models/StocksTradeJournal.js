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
    // Optional link to the forced daily swing pick this trade fulfilled.
    // Daily picks live in a separate collection from AI advice recs, so
    // trades matching a pick need their own linkage — otherwise the
    // briefing narrates them as "no linked AI rec" which is misleading.
    linkedDailyPickId: { type: mongoose.Schema.Types.ObjectId, ref: "StocksDailyPick", default: null },

    // Populated by the broker-alert email poller (Phase 2). Stable dedup
    // key derived from (source + broker + ticker + qty + price + minute-
    // truncated timestamp) so re-polls never double-insert the same
    // trade. Null for manually-recorded trades. Also used by the
    // reconciler to mark "needs review" when the account or rec linkage
    // was ambiguous.
    brokerReconcileKey: { type: String, default: null, index: true, sparse: true },
    brokerReconcileSource: { type: String, default: null }, // e.g. "cibc-email"
    brokerReconcileStatus: {
      type: String,
      enum: [null, "auto", "needs-review"],
      default: null,
    },
    brokerReconcileNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Unique on brokerReconcileKey when present so a duplicate insert throws
// instead of silently double-recording a trade. Sparse so manually-
// recorded rows (key=null) don't collide with each other.
StocksTradeJournalSchema.index(
  { email: 1, brokerReconcileKey: 1 },
  { unique: true, partialFilterExpression: { brokerReconcileKey: { $type: "string" } } }
);

const StocksTradeJournal =
  mongoose.models.StocksTradeJournal ||
  mongoose.model("StocksTradeJournal", StocksTradeJournalSchema);

export default StocksTradeJournal;
