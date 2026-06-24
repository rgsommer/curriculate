// backend/behavior/models/Behavior.js
//
// A behaviour definition (brief §5a). Two scopes:
//   standard → defined by the originator, shared to ALL teachers in the school.
//   custom   → added by one teacher, PRIVATE to that teacher (ownerTeacherId).
//              It still counts toward the student's shared cross-teacher total
//              when logged, but its DEFINITION is visible only to its author.
//
// Each behaviour carries its consequence and a follow-up type that drives the
// Phase-2 follow-up tasks + morning reminders. Editing a behaviour does NOT
// rewrite history: every incident snapshots the wording at log time, so edits
// apply only going forward (see BehaviorIncident.behaviorSnapshot).

import mongoose from "mongoose";

const BehaviorSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" }, // standard description / expectation wording

    // NEGATIVE = an offence (counts toward strikes / notifies). POSITIVE = a
    // reward (documents + awards house points, never counts as a strike, can earn
    // a good-news note). The teacher picks positive-or-negative first when
    // logging, then the behaviour list filters to that kind.
    kind: { type: String, enum: ["negative", "positive"], default: "negative", index: true },

    // Short teacher-defined category/keyword (e.g. "disrespect", "class time")
    // used to sort + group the merged behaviour list.
    keyword: { type: String, default: "", trim: true },

    // THRESHOLD   → counts toward the shared strike count.
    // IMMEDIATE   → notifies the parent on a single occurrence, regardless of count.
    // INTERACTION → documentable interaction; never notifies and never counts,
    //               but IS included in the AI Admin Summary.
    triggerMode: { type: String, enum: ["THRESHOLD", "IMMEDIATE", "INTERACTION"], default: "THRESHOLD" },

    // Consequence wording included in the note home automatically (§5a).
    consequenceText: { type: String, default: "" },

    // Offence categories (multi-select): "preparedness" (class preparedness),
    // "behaviour", "uniform". Teachers don't pick these when logging — admins set
    // them per behaviour. White-slip consequences require a "behaviour" category.
    categories: { type: [String], enum: ["preparedness", "behaviour", "uniform"], default: [] },

    // Uniform infraction (GUDD): mirrors categories including "uniform". When set,
    // logging this behaviour still counts as a normal strike AND toward losing the
    // Good Uniform Dress Down. GUDD threshold / fade / ladder live in BehaviorConfig.
    uniform: { type: Boolean, default: false },

    // House points applied when this behaviour is logged (typically negative for
    // an offence; can be positive for a positive behaviour). 0 = no points.
    points: { type: Number, default: 0 },

    // Drives Phase-2 follow-up tasks + morning reminders.
    followUpType: { type: String, enum: ["none", "next_school_day", "custom_deadline"], default: "none" },

    scope: { type: String, enum: ["standard", "custom"], default: "standard", index: true },
    // Null for standard behaviours; the BehaviorTeacher._id for custom ones.
    ownerTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null, index: true },

    // Repeat-escalation cap (§5a): consequence scales ×1 → ×2 → ×3 then holds
    // at ×3. Stored per-behaviour so admin can tune later if needed.
    escalationCapMultiplier: { type: Number, default: 3 },

    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Behavior || mongoose.model("Behavior", BehaviorSchema);
