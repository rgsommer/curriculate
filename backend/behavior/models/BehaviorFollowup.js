// backend/behavior/models/BehaviorFollowup.js
//
// An outstanding consequence to be checked (brief §8b). Created when a notice
// home includes a consequence whose behaviour has a follow-up type. The morning
// reminder job surfaces these to the assigning teacher; the teacher then marks
// each Done / Not done / Waived.
//
// Marking "not_done" escalates (see routes): a new incident is logged, the
// consequence is re-issued doubled (capped at 2×), and a fresh note home goes
// out — looping the VP in once the doubled consequence is also missed.

import mongoose from "mongoose";

const BehaviorFollowupSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", required: true, index: true },
    behaviorId: { type: mongoose.Schema.Types.ObjectId, ref: "Behavior", default: null },
    behaviorName: { type: String, default: "" },

    consequenceText: { type: String, default: "" },
    // Escalation multiplier from the missed-consequence axis (§8b): 1 = base,
    // 2 = doubled after a first miss. Capped at 2.
    multiplier: { type: Number, default: 1 },
    // How many times this consequence has been missed (drives the parent→VP
    // escalation: 0 = original, 1 = after first miss, 2+ = parent + VP).
    missLevel: { type: Number, default: 0 },

    // The teacher responsible for checking it — the teacher who LOGGED the offence
    // (so only they are prompted), falling back to the notice sender.
    assignedByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", required: true, index: true },

    // The original incident this consequence came from (for context + the date
    // shown on the reminder).
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorIncident", default: null },
    incidentAt: { type: Date, default: null },

    noticeId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorNotice", default: null },

    dueDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ["open", "done", "not_done", "waived"], default: "open", index: true },
    resolvedAt: { type: Date, default: null },
    resolvedByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null },
  },
  { timestamps: true }
);

// Hot path: a teacher's open follow-ups due today.
BehaviorFollowupSchema.index({ assignedByTeacherId: 1, status: 1, dueDate: 1 });

export default mongoose.models.BehaviorFollowup || mongoose.model("BehaviorFollowup", BehaviorFollowupSchema);
