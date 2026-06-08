// backend/behavior/models/BehaviorAuditLog.js
//
// Append-only audit trail (brief §7, §9, §10). Records every notice send and
// every config/roster change — who, when, and what. Never updated in place.

import mongoose from "mongoose";

const BehaviorAuditLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    // e.g. "notice.sent", "notice.failed", "notice.cancelled", "config.updated",
    // "roster.imported", "invite.sent", "behavior.created".
    type: { type: String, required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, default: "" },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", default: null, index: true },
    noticeId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorNotice", default: null },
    // Free-form structured context (recipient list, counts, skipped rows, etc.).
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorAuditLog || mongoose.model("BehaviorAuditLog", BehaviorAuditLogSchema);
