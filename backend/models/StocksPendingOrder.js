// backend/models/StocksPendingOrder.js
//
// "I submitted this order at my broker but it hasn't filled yet."
// Lives between Execute-click and the actual broker fill. When the fill
// arrives (or the order expires), the user comes back and either marks it
// filled (which creates a real StocksTradeJournal entry) or cancels.

import mongoose from "mongoose";

const StocksPendingOrderSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    submittedAt: { type: Date, required: true, default: Date.now },

    // What was submitted at the broker
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    ticker: { type: String, required: true, uppercase: true },
    qty: { type: Number, required: true, min: 0 },
    limitPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ["USD", "CAD"], required: true },
    settleCcy: { type: String, enum: ["USD", "CAD"], default: null },

    // Where the eventual fill should land
    account: { type: String, required: true },

    // The thesis prices (for context — not part of the actual entry order)
    targetPrice: { type: Number, default: null },
    stopPrice: { type: Number, default: null },

    // Reference to the recommendation this came from (optional)
    sourceRecId: { type: mongoose.Schema.Types.ObjectId, ref: "StocksAdviceRec", default: null },

    notes: { type: String, default: "", maxlength: 500 },

    // Status — only "submitted" lives in this collection. On fill/cancel the
    // row is deleted (fill creates a real trade journal entry instead).
    status: { type: String, enum: ["submitted"], default: "submitted" },
  },
  { timestamps: true }
);

StocksPendingOrderSchema.index({ email: 1, submittedAt: -1 });

const StocksPendingOrder =
  mongoose.models.StocksPendingOrder ||
  mongoose.model("StocksPendingOrder", StocksPendingOrderSchema);

export default StocksPendingOrder;
