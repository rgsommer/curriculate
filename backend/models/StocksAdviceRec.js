// backend/models/StocksAdviceRec.js
//
// One row per actionable trade recommendation emitted by the advice engine.
// Used to compute "if you had followed every recommendation, your portfolio
// would be X% over the last 7d / 14d / 30d."

import mongoose from "mongoose";

const StocksAdviceRecSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    generatedAt: { type: Date, required: true, default: Date.now, index: true },
    source: { type: String, enum: ["ai", "rule", "auto-sell-trail"], default: "ai" },
    // Set on trail-SELL recs auto-emitted when a BUY rec's target or stop
    // fires, so /advice history shows the full BUY→SELL round trip.
    linkedBuyRecId: { type: mongoose.Schema.Types.ObjectId, ref: "StocksAdviceRec", default: null, index: true },
    // Set on BUY recs whose targets/stops were AUTO-FILLED from technicals
    // when the AI omitted them — so we can audit the derivation later
    // (rather than silently attributing default values to the AI's judgment).
    exitLevelsFilledBy: { type: String, enum: [null, "ai", "atr-defaults"], default: null },

    // Parsed from the recommendation body
    ticker: { type: String, required: true, uppercase: true },
    action: { type: String, enum: ["BUY", "SELL", "TRIM", "HOLD"], required: true },
    shares: { type: Number, default: null },
    entryPrice: { type: Number, default: null },
    entryCurrency: { type: String, enum: ["USD", "CAD"], default: "USD" },
    targetPrice: { type: Number, default: null },
    stopPrice: { type: Number, default: null },
    horizonDays: { type: Number, default: 30 },

    // Optional: the raw body of the card the rec came from (for display)
    rationale: { type: String, default: "" },

    // Lazily filled when /performance is queried
    lastScoredAt: { type: Date, default: null },
    lastScoredPrice: { type: Number, default: null },
    lastPnlPct: { type: Number, default: null }, // signed by action direction

    // Lifecycle — updated by monitorOpenRecs() before each briefing
    status: {
      type: String,
      enum: ["open", "target-hit", "stop-hit", "expired"],
      default: "open",
      index: true,
    },
    hitAt: { type: Date, default: null },
    hitPrice: { type: Number, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastCheckedPrice: { type: Number, default: null },
  },
  { timestamps: true }
);

// Avoid duplicate recs (same ticker+action+entry within a short window)
StocksAdviceRecSchema.index({ email: 1, ticker: 1, action: 1, generatedAt: 1 });

const StocksAdviceRec =
  mongoose.models.StocksAdviceRec ||
  mongoose.model("StocksAdviceRec", StocksAdviceRecSchema);

export default StocksAdviceRec;
