// backend/behavior/models/BehaviorStudent.js
//
// A student on a school's roster (brief §3). Imported from CSV by an admin and
// re-uploadable to update. We key on a STABLE internal _id, never on names —
// the source data has duplicate first names, blank names and "DELETE"
// placeholder rows, so names are not unique. `externalId` holds the school's
// own id when the CSV provides one (used to match rows on re-import).
//
// PRIVACY (brief §10): we deliberately DO NOT store the ethnicity field. The
// importer drops it. Class/grade are kept ONLY so teachers can find a student
// fast — there is no whose-student permission layer.
//
// The threshold counter is intentionally NOT a per-teacher value: it is one
// shared count per student. `thresholdResetAt` marks the point after which
// THRESHOLD incidents count toward the next notice — incidents BEFORE it stay
// in history (for the AI context and 1st/2nd-notice logic) but no longer count.

import mongoose from "mongoose";

const ParentSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    // Pulled from Edsby once connected (brief §4); used by EdsbyProvider.
    edsbyParentId: { type: String, default: "" },
  },
  { _id: false }
);

const BehaviorStudentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },

    // School's own identifier when present in the CSV (for re-import matching).
    externalId: { type: String, default: "", trim: true, index: true },

    lastName: { type: String, default: "", trim: true },
    firstName: { type: String, default: "", trim: true },
    // Common/preferred name — used in the note home when present.
    preferredName: { type: String, default: "", trim: true },
    pronoun: { type: String, default: "", trim: true }, // e.g. "they/them" — optional, fed to the AI note
    gender: { type: String, default: "", trim: true },

    classGroup: { type: String, default: "", trim: true, index: true }, // e.g. "7A", "8B"
    grade: { type: String, default: "", trim: true, index: true },
    dob: { type: Date, default: null },

    parents: { type: [ParentSchema], default: [] },

    // ── Shared threshold state (one count per student, all teachers) ────────
    // Incidents with timestamp > thresholdResetAt count toward the next notice.
    thresholdResetAt: { type: Date, default: null },
    // Notices-home count in the CURRENT period — drives the CC-VP rule (§7).
    noticesHomeCount: { type: Number, default: 0 },
    lastNoticeAt: { type: Date, default: null },

    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// Fast name search within a school.
BehaviorStudentSchema.index({ schoolId: 1, lastName: 1, firstName: 1 });

export default mongoose.models.BehaviorStudent || mongoose.model("BehaviorStudent", BehaviorStudentSchema);
