// backend/models/SubsLessonPlan.js
//
// A lesson plan attached to a sub request, or a reusable template a
// teacher pre-stages for unexpected absences (challenge #6).
//
// Credentials (classroom-system logins/passwords) are stored ENCRYPTED —
// the `secretEnc` field holds AES-256-GCM ciphertext from
// services/subsCrypto.js. The plaintext password is never persisted and
// never logged; it is decrypted only when an assigned sub views the plan.
//
// `completeness` is derived on save so subs can see at a glance how ready
// a plan is, and filter for jobs with full plans.

import mongoose from "mongoose";

const CredentialSchema = new mongoose.Schema(
  {
    system: { type: String, default: "" }, // e.g. "Google Classroom"
    username: { type: String, default: "" },
    secretEnc: { type: String, default: "" }, // AES-256-GCM ciphertext only
  },
  { _id: false }
);

const SubsLessonPlanSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", index: true },
    // Template metadata (when isTemplate); templates aren't tied to a request.
    isTemplate: { type: Boolean, default: false },
    ownerEmail: { type: String, default: "", lowercase: true, trim: true },
    title: { type: String, default: "" },

    // Plan content.
    body: { type: String, default: "" }, // the actual lesson / activities
    routineNotes: { type: String, default: "" }, // classroom routines
    materialsLinks: { type: [String], default: [] },
    credentials: { type: [CredentialSchema], default: [] },

    // Derived 0..1 readiness score (set by the route on save).
    completeness: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.SubsLessonPlan || mongoose.model("SubsLessonPlan", SubsLessonPlanSchema);
