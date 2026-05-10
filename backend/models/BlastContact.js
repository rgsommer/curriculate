// backend/models/BlastContact.js
//
// Master contact list — every blast-campaign upload appends to this. One
// document per email. Tracks the latest contact metadata, last-contacted
// timestamp, and a per-campaign history so we can answer:
//   • "who haven't we contacted yet?"
//   • "who got the FieldDay pitch in 2026?"
//   • "when was Principal Smith last reached?"

import mongoose from "mongoose";

const blastContactHistorySchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "BlastCampaign" },
    campaignName: { type: String, default: "" },
    product: { type: String, default: "" },
    status: { type: String, default: "" },         // queued / sent / failed / bounced
    sentAt: { type: Date, default: null },
    subject: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
  },
  { _id: false }
);

const blastContactSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    firstName: { type: String, default: "" },
    lastName:  { type: String, default: "" },
    school:    { type: String, default: "", index: true },
    board:     { type: String, default: "", index: true },
    role:      { type: String, default: "" },
    level:     { type: String, default: "" },
    language:  { type: String, enum: ["en", "fr"], default: "en" },
    isChristian: { type: Boolean, default: false },

    // Counters + latest contact info
    totalCampaigns: { type: Number, default: 0 },     // distinct campaigns this contact appeared in
    sentCount: { type: Number, default: 0 },          // successful sends across all campaigns
    failedCount: { type: Number, default: 0 },
    lastContactedAt: { type: Date, default: null, index: true },
    lastCampaignId:  { type: mongoose.Schema.Types.ObjectId, ref: "BlastCampaign", default: null },
    lastProduct:     { type: String, default: "" },
    lastStatus:      { type: String, default: "" },

    // Per-campaign history (capped — most recent 50)
    history: { type: [blastContactHistorySchema], default: [] },

    unsubscribedAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },
    notes: { type: String, default: "" },

    // Provenance: where did this contact come from?
    //   "manual-upload"   = added via /blast UI CSV upload
    //   "xlsx-auto-import"= picked up by the boot-time workspace scan (A)
    //   "research-trickle"= added by the autonomous research worker (B)
    source: { type: String, default: "manual-upload", index: true },
    // Auto-discovered contacts start here so the admin can review before
    // the contact is selectable for a campaign.
    pendingReview: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

const BlastContact =
  mongoose.models.BlastContact ||
  mongoose.model("BlastContact", blastContactSchema);

export default BlastContact;
