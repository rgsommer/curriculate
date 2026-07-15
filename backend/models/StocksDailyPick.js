// backend/models/StocksDailyPick.js
//
// The forced-discipline paper portfolio. Every weekday morning the cron
// generates EXACTLY N picks (default 2) and writes them here. No cherry-
// picking, no retroactive selection. Every pick is tracked to close so
// the win rate is a real, ex-ante number.
//
// This is the honest test of whether the multi-factor engine actually
// works. Any real-time judgment happens BEFORE the pick is saved; after
// that, exits are deterministic (target-hit / stop-hit / horizon-day
// mark-to-market). Losers count.

import mongoose from "mongoose";

const StocksDailyPickSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    pickDate: { type: Date, required: true, index: true }, // 09:15 ET the day of the pick
    ticker: { type: String, required: true, uppercase: true },
    currency: { type: String, enum: ["USD", "CAD"], default: "USD" },

    // Snapshot of the entry decision
    entryPrice: { type: Number, required: true },
    targetPrice: { type: Number, default: null },
    stopPrice: { type: Number, default: null },
    horizonDays: { type: Number, default: 10 },

    // Scoring snapshot for auditability — no lookahead ever
    deterministicScore: { type: Number, default: null },
    scoreContributors: { type: [String], default: [] },
    setupName: { type: String, default: null },
    mtfConfluence: { type: String, default: null }, // aligned / mixed / conflicting

    rationale: { type: String, default: "" },

    // Lifecycle
    status: {
      type: String,
      enum: ["open", "target-hit", "stop-hit", "horizon-exit", "closed-manual"],
      default: "open",
      index: true,
    },
    exitPrice: { type: Number, default: null },
    exitDate: { type: Date, default: null },
    pnlPct: { type: Number, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastCheckedPrice: { type: Number, default: null },
  },
  { timestamps: true }
);

// A user can hold multiple picks per day; index for fast rollups.
StocksDailyPickSchema.index({ email: 1, pickDate: -1 });
StocksDailyPickSchema.index({ email: 1, status: 1 });

export default mongoose.models.StocksDailyPick || mongoose.model("StocksDailyPick", StocksDailyPickSchema);
