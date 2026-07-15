// backend/models/StocksAlert.js
//
// Price-based swing-trade alerts. The user says "ping me when NVDA
// breaks $145 with 2x volume" and this doc stores that intent. A
// cron ticks during market hours, checks the last Yahoo price + RVOL
// against each active alert, and fires a Resend email when triggered.
// Once fired an alert becomes inactive so the user isn't spammed
// (they can re-arm it from the UI if they want a repeat trigger).

import mongoose from "mongoose";

const StocksAlertSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true, lowercase: true, trim: true },
    ticker: { type: String, required: true, uppercase: true, trim: true },
    currency: { type: String, default: "USD" },
    // "above" fires when last >= price; "below" fires when last <= price.
    // rvolMin is optional — if set, the price condition ALSO requires
    // today's RVOL to be at least this multiple (2 = 2× 20d avg volume).
    condition: { type: String, enum: ["above", "below"], required: true },
    price: { type: Number, required: true },
    rvolMin: { type: Number, default: null },
    note: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
    // Filled in once triggered — the price+rvol at trigger time.
    triggeredAt: { type: Date, default: null },
    triggeredPrice: { type: Number, default: null },
    triggeredRvol: { type: Number, default: null },
    // Non-critical bookkeeping.
    lastCheckedAt: { type: Date, default: null },
    createdVia: { type: String, default: "web" }, // "web" | "briefing" | "adversarial"
  },
  { timestamps: true }
);

StocksAlertSchema.index({ email: 1, active: 1 });
StocksAlertSchema.index({ ticker: 1, active: 1 });

export default mongoose.models.StocksAlert || mongoose.model("StocksAlert", StocksAlertSchema);
