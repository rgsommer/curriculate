// backend/behavior/models/BehaviorInvite.js
//
// An invitation for a teacher to join a Behaviours school (brief §5d). The
// originator/admin types one or more email addresses and clicks Invite; we
// create one of these per address and email them a tokenised accept link.
// Modeled on the existing SubsInvite pattern.
//
// Invites are restricted to the school's email domain (taken from the
// originator's email) — the route rejects any address outside it before a
// document is ever created, but we also store the domain for auditability.

import mongoose from "mongoose";

const BehaviorInviteSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    token: { type: String, required: true, index: true },
    // Role the invitee will receive on accept. Only originator can grant admin.
    role: { type: String, enum: ["admin", "teacher", "principal"], default: "teacher" },
    status: { type: String, enum: ["pending", "accepted", "revoked"], default: "pending", index: true },
    invitedByEmail: { type: String, default: "", lowercase: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorInvite || mongoose.model("BehaviorInvite", BehaviorInviteSchema);
