// backend/models/StocksPositionStopFire.js
//
// Dedup log for real-time P&L stop alerts. One row per unique
// (email, ticker, account, tier, dateStr) — guarantees we email at
// most once per position per tier per day, even if the alerts cron
// re-detects the same threshold on every 5-minute tick.
//
// Tier escalations DO get a fresh email (e.g. WATCH → WITHIN →
// HARD_STOP each fire once as the position deteriorates) because
// they're different (tier) values in the compound key.

import mongoose from "mongoose";

const StocksPositionStopFireSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    ticker: { type: String, required: true, uppercase: true },
    account: { type: String, default: "" },
    tier: { type: String, enum: ["watch", "within-stop", "hard-stop-hit"], required: true },
    dateStr: { type: String, required: true }, // YYYY-MM-DD in ET
    firedAt: { type: Date, default: Date.now },
    priceAtFire: { type: Number, default: null },
    pnlPctAtFire: { type: Number, default: null },
    currency: { type: String, default: "USD" },
  },
  { timestamps: true }
);

StocksPositionStopFireSchema.index(
  { email: 1, ticker: 1, account: 1, tier: 1, dateStr: 1 },
  { unique: true }
);

export default mongoose.models.StocksPositionStopFire ||
  mongoose.model("StocksPositionStopFire", StocksPositionStopFireSchema);
