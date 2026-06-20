// backend/behavior/models/HomeworkAssignment.js
//
// One assignment for a class (brief: Homework tab). Types:
//   homework  — done at home; shown in person on completion.
//   work      — use of class time.
//   discussion— a live "Formal Discussion" scored out of 10 (see HomeworkScore).
// Grades are out of `denom` (default 10). `date` is the assigned/due date and
// drives the late-tap auto-scoring + which term it belongs to.

import mongoose from "mongoose";

const HomeworkAssignmentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorTeacher", required: true, index: true },
    classGroup: { type: String, required: true, trim: true, index: true },
    subject: { type: String, default: "", trim: true, index: true },
    type: { type: String, enum: ["homework", "work", "discussion"], default: "homework", index: true },
    description: { type: String, default: "", trim: true },
    denom: { type: Number, default: 10 },
    date: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

HomeworkAssignmentSchema.index({ schoolId: 1, classGroup: 1, date: -1 });

export default mongoose.models.HomeworkAssignment || mongoose.model("HomeworkAssignment", HomeworkAssignmentSchema);
