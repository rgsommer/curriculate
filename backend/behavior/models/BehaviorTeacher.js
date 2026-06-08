// backend/behavior/models/BehaviorTeacher.js
//
// A teacher's MEMBERSHIP in a Behaviours school. This is distinct from the
// shared Curriculate `User` (the sign-in identity): a BehaviorTeacher links a
// User to a school and carries their role + per-user signature for the note
// home. We reuse the existing email+password JWT auth (routes/auth.js); this
// model is purely the school-scoped role/profile record.
//
// Roles:
//   originator → created the school; can edit Setup; can grant admin.
//   admin      → can edit Setup + invite (granted by originator).
//   teacher    → can log incidents against ANY student + see cross-teacher
//                status, but cannot edit Setup.
//   principal  → read-only school-wide dashboard (Phase 4); no logging, no Setup.
//
// There is deliberately NO student↔teacher mapping anywhere in the system —
// any teacher may log against any student in the school (brief §3).

import mongoose from "mongoose";

const BehaviorTeacherSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, default: "", trim: true },

    role: {
      type: String,
      enum: ["originator", "admin", "teacher", "principal"],
      default: "teacher",
      index: true,
    },

    // Signature block appended to this teacher's notes home (brief §5c —
    // per-teacher, not a hardcoded single teacher).
    signature: { type: String, default: "" },

    // Per-teacher morning-reminder delivery preference (brief §8b). Division
    // sets the send time; the teacher picks the channel(s). Used in Phase 2.
    morningReminderPrefs: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
    },

    // pending until they accept their invite and sign in; accepted thereafter.
    status: { type: String, enum: ["pending", "accepted"], default: "accepted", index: true },
  },
  { timestamps: true }
);

// One membership per (school, user).
BehaviorTeacherSchema.index({ schoolId: 1, userId: 1 }, { unique: true });

export default mongoose.models.BehaviorTeacher || mongoose.model("BehaviorTeacher", BehaviorTeacherSchema);
