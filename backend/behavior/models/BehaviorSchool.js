// backend/behavior/models/BehaviorSchool.js
//
// A school/division in the Behaviours app (curriculate.net/behavior). The
// "originator" is the teacher who created the setup — they own the shared
// division configuration and invite the other teachers. Admin can be granted
// to others (more than one admin allowed) so the setup survives the
// originator leaving.
//
// `emailDomain` is derived from the originator's own email at creation time
// and is the allow-list for invites: only addresses on this domain may be
// invited (see BehaviorInvite + routes).

import mongoose from "mongoose";

const BehaviorSchoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // The User._id of the teacher who first set up this school.
    originatorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Lower-cased email domain (e.g. "bramptoncs.org") taken from the
    // originator's email — invites are restricted to this domain.
    emailDomain: { type: String, required: true, lowercase: true, trim: true, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorSchool || mongoose.model("BehaviorSchool", BehaviorSchoolSchema);
