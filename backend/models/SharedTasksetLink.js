import mongoose from "mongoose";

const InviteSchema = new mongoose.Schema(
  {
    toEmail: { type: String, default: "" },
    ccEmail: { type: String, default: "" },

    senderUserId: { type: String, default: "" },
    senderName: { type: String, default: "" },

    sentAt: { type: Date },

    // Follow-ups
    followup7SentAt: { type: Date },
    followup30SentAt: { type: Date },

    // Stop follow-ups once the recipient actually runs it
    firstUsedAt: { type: Date },

    // Referral / reward tracking (sender incentive program)
    countedForReward: { type: Boolean, default: false },
    rewardSentAt: { type: Date },
  },
  { _id: false }
);

const SharedTasksetLinkSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    tasksetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskSet",
      required: true,
      index: true,
    },

    // “TaskSet from …”
    ownerId: { type: String, required: true, index: true },
    ownerName: { type: String, default: "" },
    ownerEmail: { type: String, default: "" },

    // Optional: keep it compatible with your access-code world
    entryCode: { type: String, default: "", index: true },

    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },

    createdByUserId: { type: String, default: "" },

    // Email + follow-up tracking
    invites: { type: [InviteSchema], default: [] },

    // Basic usage tracking
    firstUsedAt: { type: Date },
    lastUsedAt: { type: Date },
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// auto-delete expired links
SharedTasksetLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("SharedTasksetLink", SharedTasksetLinkSchema);
