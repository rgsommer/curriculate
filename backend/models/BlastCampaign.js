// backend/models/BlastCampaign.js
//
// A "Blast" campaign — bulk outbound marketing email to a CSV of school admins.
// One campaign = one product (Curriculate / Pulse / FieldDay) + one set of
// recipients. The scheduler trickles sends out at 50/day during teacher-friendly
// hours (Tue/Wed/Thu 7:30–8:30 AM ET by default), respecting Resend's free tier
// cap of 100/day shared with other system traffic.

import mongoose from "mongoose";

const blastCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    product: {
      type: String,
      enum: ["curriculate", "pulse", "fieldday"],
      required: true,
    },

    // Templates — separate English + French bodies. The scheduler picks based
    // on each recipient's `language` field (auto-set from board).
    subjectEn: { type: String, default: "" },
    bodyEn: { type: String, default: "" }, // HTML, supports {{firstName}}, {{school}}, {{board}}, {{role}}
    subjectFr: { type: String, default: "" },
    bodyFr: { type: String, default: "" },

    // Sender identity
    fromName: { type: String, default: "Curriculate" },
    fromAddress: { type: String, default: "noreply@curriculate.net" },
    replyTo: { type: String, default: "" },

    // Scheduling
    dailyCap: { type: Number, default: 50, min: 1, max: 100 },
    sendDays: { type: [Number], default: [2, 3, 4] }, // 0=Sun..6=Sat → default Tue/Wed/Thu
    // Months when this campaign is allowed to send (1-12). Empty array means
    // every month. Used to enforce seasonal relevance — e.g. Field Day
    // campaigns set [4, 5, 6] so they never accidentally send in July or
    // November when the topic is irrelevant.
    enabledMonths: { type: [Number], default: [] },
    sendStartHour: { type: Number, default: 7 }, // local ET hour (0-23) — start of send window
    sendStartMinute: { type: Number, default: 30 },
    sendEndHour: { type: Number, default: 8 },
    sendEndMinute: { type: Number, default: 30 },
    timezone: { type: String, default: "America/Toronto" },

    // Status
    status: {
      type: String,
      enum: ["draft", "scheduled", "running", "paused", "completed", "cancelled"],
      default: "draft",
      index: true,
    },

    // Aggregate counters (denormalized for dashboard speed; refreshed by worker)
    totalRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    bouncedCount: { type: Number, default: 0 },

    createdBy: { type: String, default: "admin" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

const BlastCampaign =
  mongoose.models.BlastCampaign ||
  mongoose.model("BlastCampaign", blastCampaignSchema);

export default BlastCampaign;
