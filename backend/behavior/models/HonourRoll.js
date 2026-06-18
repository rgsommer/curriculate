// backend/behavior/models/HonourRoll.js
//
// Honour-roll (weighted-averages) feature backing the /avgs Edsby panel.
// Two models, one per concern:
//
//   HonourRollConfig   — one per school: grade range, tier thresholds, and the
//                        curated class list with per-class weights. Classes are
//                        discovered by probing Edsby; weights start as name-based
//                        guesses (days/week ÷ 5) and are teacher-editable.
//   HonourRollSnapshot — one per refresh: every student's courses, weighted
//                        average and tier at that moment, plus diagnostics
//                        (students missing Edsby nids, fetch failures, raw
//                        shape notes for unverified Edsby views).

import mongoose from "mongoose";

const ClassWeightSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // as discovered in Edsby
    daysPerWeek: { type: Number, default: 2 },
    weight: { type: Number, default: 0.4 }, // usually daysPerWeek/5; CE is the exception (0.5)
    include: { type: Boolean, default: true },
    source: { type: String, default: "probe" }, // probe | manual
    note: { type: String, default: "" }, // e.g. "unrecognized — review"
  },
  { _id: false }
);

const HonourRollConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, unique: true },
    gradeMin: { type: Number, default: 6 },
    gradeMax: { type: Number, default: 8 },
    honours: { type: Number, default: 80 }, // weighted avg ≥ this → Honours
    highHonours: { type: Number, default: 90 }, // ≥ this → High Honours
    // Edsby "My Students" Zoom node id(s) to read the student list from, comma-
    // separated (one Zoom often covers only some grades). Found in the Edsby
    // URL /p/ZoomMyStudents/<nid>. Used to harvest student nids.
    zoomNid: { type: String, default: "" },
    classes: { type: [ClassWeightSchema], default: [] },
  },
  { timestamps: true }
);

const SnapshotCourseSchema = new mongoose.Schema(
  { name: String, pct: Number, weight: Number, matched: Boolean },
  { _id: false }
);

const SnapshotStudentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent" },
    edsbyNid: { type: String, default: "" },
    name: { type: String, default: "" },
    grade: { type: String, default: "" },
    classGroup: { type: String, default: "" },
    weightedAvg: { type: Number, default: null },
    tier: { type: String, default: "" }, // "" | honours | high-honours
    courses: { type: [SnapshotCourseSchema], default: [] },
    edsbyAverage: { type: Number, default: null }, // Edsby's own unweighted avg, for reference
    prevWeightedAvg: { type: Number, default: null }, // weighted avg at the previous refresh
    improvement: { type: Number, default: null }, // weightedAvg − prevWeightedAvg (points)
    error: { type: String, default: "" }, // per-student fetch/extract failure
  },
  { _id: false }
);

const HonourRollSnapshotSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    takenAt: { type: Date, default: Date.now },
    students: { type: [SnapshotStudentSchema], default: [] },
    // Operational notes: skipped students, view diagnostics, session problems.
    diagnostics: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
HonourRollSnapshotSchema.index({ schoolId: 1, takenAt: -1 });

export const HonourRollConfig =
  mongoose.models.HonourRollConfig || mongoose.model("HonourRollConfig", HonourRollConfigSchema);
export const HonourRollSnapshot =
  mongoose.models.HonourRollSnapshot || mongoose.model("HonourRollSnapshot", HonourRollSnapshotSchema);
