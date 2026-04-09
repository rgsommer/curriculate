import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Agent referral codes.
 *
 * An agent (sales rep, partner, ambassador) gets a unique referral code.
 * When a new subscriber enters it at checkout, the agent is credited with the sale.
 * Admins can issue, disable, and track these from the admin panel.
 */
const ReferralCodeSchema = new Schema(
  {
    // The code itself — e.g. "TEACH-JANE" or "REF-A7K3M"
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    // Agent info
    agentName: { type: String, required: true, trim: true },
    agentEmail: { type: String, required: true, trim: true, lowercase: true },

    // Commission
    commissionPercent: {
      type: Number,
      default: 15,
      min: 0,
      max: 100,
    },

    // How many months the commission applies per conversion (0 = one-time)
    commissionDurationMonths: {
      type: Number,
      default: 0, // 0 = one-time payout per conversion
    },

    // Optional discount the referred customer gets (percent off first payment)
    customerDiscountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // Tracking
    conversions: [
      {
        userId: { type: String },
        userEmail: { type: String },
        planTier: { type: String },
        convertedAt: { type: Date, default: Date.now },
        stripeSubscriptionId: { type: String },
        amountCents: { type: Number, default: 0 },
        commissionCents: { type: Number, default: 0 },
        paid: { type: Boolean, default: false },
        paidAt: { type: Date },
      },
    ],

    // Stats (denormalized for fast admin reads)
    totalConversions: { type: Number, default: 0 },
    totalRevenueCents: { type: Number, default: 0 },
    totalCommissionCents: { type: Number, default: 0 },
    totalPaidCents: { type: Number, default: 0 },

    disabled: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },

    // Optional notes from admin
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Index for fast lookup during checkout
ReferralCodeSchema.index({ code: 1 });
ReferralCodeSchema.index({ agentEmail: 1 });

const ReferralCode =
  mongoose.models.ReferralCode ||
  mongoose.model("ReferralCode", ReferralCodeSchema);

export default ReferralCode;
