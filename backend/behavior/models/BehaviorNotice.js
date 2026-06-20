// backend/behavior/models/BehaviorNotice.js
//
// A notice home (brief §7). Records who it was from, to whom, on which
// channel(s), the full rendered text, and the audit trail. The note is FROM the
// teachers whose incidents make up the accumulated strikes (not a single
// homeroom teacher) — `fromTeachers` lists them and the behaviour each logged.
//
// CC-VP rule (§7): ccVp is true when this is the 2nd-or-later notice home for
// the student in the current period.
//
// Send model: because the school chose fully-automatic send, a notice is
// created with status "queued", a short cancellable window is offered, then the
// dispatcher flips it to "sent" (or "failed"/"cancelled"). This is also the
// persistent communication-history record (brief §7b).

import mongoose from "mongoose";

const FromTeacherSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher" },
    name: { type: String, default: "" },
    behaviorName: { type: String, default: "" },
  },
  { _id: false }
);

const RecipientSchema = new mongoose.Schema(
  {
    role: { type: String, default: "parent" }, // parent | vp
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    edsbyParentId: { type: String, default: "" },
  },
  { _id: false }
);

const BehaviorNoticeSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", required: true, index: true },

    // Period bookkeeping for the CC-VP rule and 1st/2nd/Nth-notice wording.
    periodNo: { type: Number, default: 1 },
    sequenceNo: { type: Number, default: 1 }, // 1 = first notice this period

    reason: { type: String, enum: ["threshold", "immediate", "missed_consequence", "positive"], default: "threshold" },

    fromTeachers: { type: [FromTeacherSchema], default: [] },
    triggeringIncidentIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    consequenceTexts: { type: [String], default: [] },

    channels: { type: [String], default: [] }, // e.g. ["email"], ["edsby","email"]
    recipients: { type: [RecipientSchema], default: [] },
    ccVp: { type: Boolean, default: false },

    renderedText: { type: String, default: "" }, // full AI- (or template-) composed note
    aiUsed: { type: Boolean, default: false }, // false => deterministic fallback was used

    status: { type: String, enum: ["queued", "sent", "failed", "cancelled"], default: "queued", index: true },
    // Per-channel delivery outcome (for the email/Edsby failover audit).
    deliveries: {
      type: [
        {
          channel: String,
          ok: Boolean,
          error: { type: String, default: "" },
          at: Date,
          _id: false,
        },
      ],
      default: [],
    },

    // The teacher whose log triggered this notice (the "sender" of record).
    sentByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null },
    // Backfilled from the legacy behaviour spreadsheet (reversible marker).
    legacyImport: { type: Boolean, default: false, index: true },
    // True when this notice should auto-send after its window (auto mode). The
    // sweeper only dispatches autoDispatch notices, so draft-mode notices that
    // await a manual send are never swept.
    autoDispatch: { type: Boolean, default: true },
    // Teacher chose to send the incident's photo/video evidence WITH this notice
    // (email = attachments, Edsby = links). Default false: evidence stays
    // teacher-side unless explicitly shared.
    includeEvidence: { type: Boolean, default: false },
    queuedAt: { type: Date, default: () => new Date() },
    sentAt: { type: Date, default: null },
    cancelUntil: { type: Date, default: null }, // end of the cancellable window
  },
  { timestamps: true }
);

BehaviorNoticeSchema.index({ studentId: 1, createdAt: -1 });

export default mongoose.models.BehaviorNotice || mongoose.model("BehaviorNotice", BehaviorNoticeSchema);
