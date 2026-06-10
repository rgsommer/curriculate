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
    name: { type: String, default: "" },
    grade: { type: String, default: "" },
    classGroup: { type: String, default: "" },
    weightedAvg: { type: Number, default: null },
    tier: { type: String, default: "" }, // "" | honours | high-honours
    courses: { type: [SnapshotCourseSchema], default: [] },
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
