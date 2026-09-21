// backend/behavior/models/BehaviorConsequence.js
//
// A consequence a teacher or admin actually applied to a student — separate from
// the consequence wording auto-included in a notice home. Lets staff document
// real-world follow-through: a work detention, a white slip, a call home, etc.
// Appears in the student record, the AI summaries, and (optionally) the notice.

import mongoose from "mongoose";

const BehaviorConsequenceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", required: true, index: true },

    // Free-text type, usually chosen from the approved-consequence list
    // (e.g. "White slip", "Work detention", "Call home", "Lines 20×").
    type: { type: String, required: true, trim: true },
    detail: { type: String, default: "" }, // optional note / specifics

    // Tone of the record. Disciplinary consequences are "corrective" (the default
    // and how they're shown under Consequences); an encouraging parent note is
    // logged as "encouraging" and shown under the student's Encouragements.
    kind: { type: String, enum: ["encouraging", "corrective"], default: "corrective", index: true },

    // Who applied/recorded it.
    byTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", index: true },
    byName: { type: String, default: "" },

    // Optional link to the incident this consequence was for (used to enforce the
    // white-slip → "behaviour" category rule).
    relatedIncidentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorIncident", default: null },

    // Lifecycle for white slips: "recommended" once the VP is emailed, then
    // "issued" when any staff member confirms it was actually given, or "other"
    // if a different consequence was applied instead (that different consequence
    // is logged as its own "issued" record). Directly-documented consequences
    // (detention, call home) are "issued" from the start.
    status: { type: String, enum: ["recommended", "issued", "other"], default: "issued", index: true },
    issuedByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null },
    issuedByName: { type: String, default: "" },
    issuedAt: { type: Date, default: null },

    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorConsequence || mongoose.model("BehaviorConsequence", BehaviorConsequenceSchema);
