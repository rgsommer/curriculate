// backend/models/BlastRecipient.js
//
// One row per (campaign × recipient). Each row is scheduled to send at a
// specific minute inside the campaign's send window. The worker pulls due
// rows, sends them via Resend, and marks them sent/failed.

import mongoose from "mongoose";

const blastRecipientSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlastCampaign",
      required: true,
      index: true,
    },

    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },

    // Contextual fields used for variable substitution and language routing
    school: { type: String, default: "" },
    board: { type: String, default: "" },
    role: { type: String, default: "" },     // Principal / Vice-Principal / etc.
    level: { type: String, default: "" },    // Elementary / Secondary
    language: { type: String, enum: ["en", "fr"], default: "en", index: true },
    isChristian: { type: Boolean, default: false }, // → unlocks Christian-perspective copy block

    // Delivery state
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed", "skipped", "bounced", "unsubscribed"],
      default: "queued",
      index: true,
    },
    scheduledFor: { type: Date, required: true, index: true },
    sentAt: { type: Date, default: null },
    resendId: { type: String, default: "" },     // Resend message ID for bounce-tracking
    errorMessage: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound index makes "next due in this campaign" queries fast
blastRecipientSchema.index({ campaignId: 1, status: 1, scheduledFor: 1 });
// Prevent the same email being queued twice in the same campaign
blastRecipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });

const BlastRecipient =
  mongoose.models.BlastRecipient ||
  mongoose.model("BlastRecipient", blastRecipientSchema);

export default BlastRecipient;
