// backend/behavior/models/HomeworkScore.js
//
// A student's result on one assignment. A row exists once the student has been
// scored (or messaged about while still outstanding). NO row = outstanding (the
// student hasn't shown/done it). `score` is out of the assignment's denom.
//
// Auto-scoring (single tap) for homework/work uses the assignment age:
//   ≤3 days late → full (10) · >3 days → 7.2 · older than `lateWeeks` → 6.2.
// Double-tap edits to any value (manual). For a Formal Discussion the score is
// computed live from +/- ticks (baseline 5 on first +).

import mongoose from "mongoose";

const HomeworkScoreSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "HomeworkAssignment", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorStudent", required: true, index: true },

    score: { type: Number, default: null }, // null = outstanding / not yet shown
    // Excused (teacher tapped "E", e.g. absent): dropped from totals + averages
    // entirely — neither counted as 0 nor toward the denominator.
    excused: { type: Boolean, default: false },
    manual: { type: Boolean, default: false }, // set by a double-tap edit
    scoredByTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher" },
    scoredAt: { type: Date, default: null },

    // Formal-discussion live tallies (kept for the record + re-open).
    discussion: {
      plus: { type: Number, default: 0 },
      minus: { type: Number, default: 0 },
      absent: { type: Boolean, default: false },
    },

    // Last time this (still-outstanding) assignment was included in a "fallen
    // behind" message home — colours the cell + drives the resend cooldown.
    messagedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One score per (assignment, student).
HomeworkScoreSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
HomeworkScoreSchema.index({ schoolId: 1, studentId: 1 });

export default mongoose.models.HomeworkScore || mongoose.model("HomeworkScore", HomeworkScoreSchema);
