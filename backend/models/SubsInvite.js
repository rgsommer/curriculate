// backend/models/SubsInvite.js
//
// Tracks a school's invitation of a substitute by email (the multi-school
// registration flow). The admin enters a sub's email; we create/attach the
// SubsTeacher, add the school to their schoolIds, and email/SMS them a
// link. When they click it and sign in, the app lists every school they're
// registered with (so one sub serves several schools from one login).
//
// The token gates the invite-accept view; status flips to "accepted" once
// they've signed in via the link.

import mongoose from "mongoose";

const SubsInviteSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true },
    token: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "accepted"], default: "pending" },
    invitedByEmail: { type: String, default: "", lowercase: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.SubsInvite || mongoose.model("SubsInvite", SubsInviteSchema);
