// backend/models/EmailLoginPin.js
//
// Short-lived PIN codes for passwordless email login (used by the /tasks app).
// PINs auto-expire via a TTL index on `expiresAt`.
import mongoose from "mongoose";

const { Schema } = mongoose;

const EmailLoginPinSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    pinHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 }, // TTL — Mongo deletes after expiry
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const EmailLoginPin =
  mongoose.models.EmailLoginPin ||
  mongoose.model("EmailLoginPin", EmailLoginPinSchema);

export default EmailLoginPin;
