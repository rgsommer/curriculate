// backend/models/SubsRequest.js
//
// A request for a substitute teacher, posted by a school admin for a
// specific grade level and date.
//
// `urgency` selects the escalation cadence — the ONLY behavioural
// difference between the two modes is how long the engine waits before
// moving to the next preferred sub:
//   • "urgent"  (same-day)        → short interval (default 5 min)
//   • "advance" (planned absence) → long interval  (default 4 hours)
// The resolved interval is frozen onto the request as
// `escalationIntervalMs` when it's created, so changing the defaults
// later doesn't retroactively alter in-flight requests.
//
// Lifecycle (`status`):
//   open      → actively contacting subs in preference order
//   filled    → a sub accepted; contacting has stopped
//   exhausted → ran out of ranked subs with no acceptance
//   cancelled → admin cancelled before it was filled

import mongoose from "mongoose";

export const URGENT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const ADVANCE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

const SubsRequestSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", required: true, index: true },
    gradeLevelId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsGradeLevel", required: true },
    // The date the substitute is needed (school-local calendar day).
    date: { type: String, required: true }, // YYYY-MM-DD
    urgency: { type: String, enum: ["urgent", "advance"], required: true },
    // Frozen escalation interval (ms) — derived from urgency at creation.
    escalationIntervalMs: { type: Number, required: true },
    notes: { type: String, default: "", trim: true },
    createdByEmail: { type: String, default: "", lowercase: true, trim: true },

    // ── Source & teacher-initiated approval workflow ───────────────────
    // "admin": posted by a principal/VP (goes live immediately).
    // "teacher": a staff teacher reported their own absence — it sits in
    // "pending_approval" until a principal approves, which fires the engine.
    source: { type: String, enum: ["admin", "teacher"], default: "admin" },
    reason: { type: String, default: "" }, // sick, personal, PD, …
    requestedByEmail: { type: String, default: "", lowercase: true, trim: true },
    // The teacher being covered. On a fill they're emailed "X is covering
    // for you — reply-all (VP cc'd) with your lesson plans".
    absentTeacher: { name: { type: String, default: "" }, email: { type: String, default: "", lowercase: true, trim: true } },
    approvedByEmail: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    denyReason: { type: String, default: "" },

    // Time the sub is needed (HH:MM) — drives the morning "time-to-bell"
    // countdown (challenge #2). Falls back to the school's bellTime.
    startTime: { type: String, default: "" },
    // Coverage window the teacher/admin specified:
    //   "full"   → whole day
    //   "am"     → half day, morning only
    //   "pm"     → half day, afternoon only
    //   "custom" → specific times (startTime–endTime, e.g. 09:00–11:00)
    dayPart: { type: String, enum: ["full", "am", "pm", "custom"], default: "full" },
    endTime: { type: String, default: "" }, // used with dayPart "custom"

    // ── Matching requirements (challenges #1, #5, #10, #11) ────────────
    // Only subs who satisfy ALL of these are offered the job.
    requiredRole: { type: String, default: "teacher" }, // teacher | ea | specialist | tech
    // Division (grade range) of the class, denormalized from the grade so
    // eligibility can check a sub's approved divisions without a join.
    division: { type: String, default: "" },
    requiredQualifications: { type: [String], default: [] },
    requiredFaithFit: { type: [String], default: [] }, // subset of FAITH_KEYS

    // ── Challenging-class context (challenge #4; private to admins) ────
    difficultyNote: { type: String, default: "" },
    supportLevel: { type: String, default: "" }, // e.g. "EA present", "admin on call"

    // ── Lesson plan (challenge #6) ─────────────────────────────────────
    lessonPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsLessonPlan", default: null },

    // Optional voice note recorded by the teacher for a sick day (the
    // principal can play it from the approval). Stored separately to keep
    // this document small. `voiceNoteStatus` tells the approver whether one
    // is attached, or that recording failed on the teacher's device (we
    // never block a genuinely-sick teacher just because their mic didn't
    // cooperate — the request still goes through, flagged for the approver).
    voiceNoteId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsVoiceNote", default: null },
    voiceNoteStatus: { type: String, enum: ["none", "attached", "failed"], default: "none" },

    // ── Budget snapshot (challenge #7; scaffold) ───────────────────────
    estimatedCost: { type: Number, default: null },

    // Eligible-candidate count computed at post time so the dashboard can
    // immediately flag "0 qualified candidates" (challenge #1).
    eligibleCountAtPost: { type: Number, default: null },

    status: {
      type: String,
      enum: ["pending_approval", "open", "filled", "exhausted", "cancelled", "denied"],
      default: "open",
      index: true,
    },
    // Why an exhausted request ran out: "no_eligible" (nobody qualified) vs
    // "all_declined" (everyone qualified passed). Drives the right nudge.
    exhaustedReason: { type: String, default: null },
    // Rank of the teacher currently being (or last) contacted.
    currentRank: { type: Number, default: -1 },

    // Set when filled. coverageType distinguishes a paid external sub from
    // internal coverage (challenge #8).
    coverageType: { type: String, enum: ["external", "internal", null], default: null },
    filledByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsTeacher", default: null },
    filledOfferId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsOffer", default: null },
    internalCoverageId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsInternalCoverage", default: null },
    filledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.SubsRequest || mongoose.model("SubsRequest", SubsRequestSchema);
