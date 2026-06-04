// backend/models/SubsAuthPin.js
//
// Server-side state for the passwordless email-PIN sign-in used by /subs
// (both school admins and substitute teachers sign in this way).
//
// Mirrors StocksAuthPin: one active record per email, holds the HMAC of
// the issued PIN plus an attempt counter so verify-pin can lock out
// brute-force guessing. Records auto-expire via a TTL index.

import mongoose from "mongoose";

const SubsAuthPinSchema = new mongoose.Schema(
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

SubsAuthPinSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.SubsAuthPin || mongoose.model("SubsAuthPin", SubsAuthPinSchema);
