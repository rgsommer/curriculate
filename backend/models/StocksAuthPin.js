// backend/models/StocksAuthPin.js
//
// Server-side state for the passwordless email-PIN sign-in used by /stocks.
//
// One active record per email (upserted on each request-pin). Holds the
// HMAC of the issued PIN plus an attempt counter so verify-pin can lock out
// brute-force guessing — the whole point of moving PIN verification off the
// stateless frontend route. Records auto-expire via a TTL index.

import mongoose from "mongoose";

const StocksAuthPinSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    // HMAC-SHA256(pin | email, secret) — never store the raw PIN.
    pinHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    consumed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL — Mongo removes the doc once expiresAt passes, so a stale/locked PIN
// can't linger. A fresh request-pin must be made after expiry.
StocksAuthPinSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("StocksAuthPin", StocksAuthPinSchema);
