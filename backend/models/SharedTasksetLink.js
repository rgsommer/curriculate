// backend/models/SharedTasksetLink.js
import mongoose from "mongoose";
import crypto from "crypto";

/**
 * SharedTasksetLink
 *
 * Security upgrade:
 * - tokenHash (sha256 of raw token) is the canonical lookup key.
 * - token is OPTIONAL for backward compatibility during rollout.
 *
 * Recommended flow when creating a link:
 *   const token = crypto.randomBytes(16).toString("hex");
 *   const tokenHash = hashShareToken(token);
 *   await SharedTasksetLink.create({ tokenHash, token, ... }); // token optional
 *   return token to client (never store it anywhere else).
 */

export function hashShareToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""), "utf8")
    .digest("hex");
}

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
    // NEW (canonical)
    tokenHash: { type: String, required: true, unique: true, index: true },

    // BACK-COMPAT (optional)
    // - Keep for a short transition window so old code still works.
    // - Mark sparse so multiple docs without token won't violate unique index.
    token: { type: String, unique: true, sparse: true, index: true },

    tasksetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskSet",
      required: true,
      index: true,
    },

    // "TaskSet from …"
    ownerId: { type: String, required: true, index: true },
    ownerName: { type: String, default: "" },
    ownerEmail: { type: String, default: "" },

    // Display-only (requested): "R. Sommer"
    authorDisplay: { type: String, default: "" },

    // Optional: keep it compatible with your access-code world
    entryCode: { type: String, default: "", index: true },

    // Optional: class roster the sending teacher bound to this link.
    // When set, sessions launched via this link inherit the class binding,
    // so the student-app shows a name dropdown and the report CSV gets
    // Edsby Student IDs filled in automatically. Sub teacher does not see
    // or interact with class selection.
    classRosterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClassRoster",
      default: null,
    },

    expiresAt: { type: Date, required: true },
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

// Safety: if someone sets token but forgets tokenHash, compute it.
SharedTasksetLinkSchema.pre("validate", function (next) {
  try {
    if (!this.tokenHash && this.token) {
      this.tokenHash = hashShareToken(this.token);
    }
  } catch {}
  next();
});

export default mongoose.models.SharedTasksetLink ||
  mongoose.model("SharedTasksetLink", SharedTasksetLinkSchema);
