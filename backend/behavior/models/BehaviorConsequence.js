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

    // Who applied/recorded it.
    byTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", index: true },
    byName: { type: String, default: "" },

    // Optional link to the incident this consequence was for (used to enforce the
    // white-slip → "behaviour" category rule).
    relatedIncidentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorIncident", default: null },

    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorConsequence || mongoose.model("BehaviorConsequence", BehaviorConsequenceSchema);
