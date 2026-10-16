// backend/behavior/models/TallyEvent.js
//
// One counted event (food drive, cleanup, read-a-thon…) from the Tally import.
// Keeps every student's count and the points scale used, so a count can be
// corrected later (e.g. late items) and the placements + points recalculated.
// The house-point awards it made carry tallyEventId, so a recalculation deletes
// and re-awards them idempotently.

import mongoose from "mongoose";

const TallyRowSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", required: true },
    items: { type: Number, default: 0 },
  },
  { _id: false }
);

const TallyEventSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    label: { type: String, default: "Food Drive" },
    at: { type: Date, default: () => new Date() }, // award date (kept on recalculation)
    individual: { type: [Number], default: [30, 20, 10] }, // top-donor points
    house: { type: [Number], default: [100, 60, 30, 10] }, // house placement points
    rows: { type: [TallyRowSchema], default: [] },
    // Last computed outcome (for the list + "what changed" on an edit).
    results: { type: mongoose.Schema.Types.Mixed, default: null },
    createdByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", default: null },
    edits: {
      type: [{ at: Date, byName: String, note: String, _id: false }],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.models.TallyEvent || mongoose.model("TallyEvent", TallyEventSchema);
