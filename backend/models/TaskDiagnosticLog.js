// backend/models/TaskDiagnosticLog.js
import mongoose from "mongoose";

const TaskDiagnosticLogSchema = new mongoose.Schema(
  {
    tasksetId: { type: String, required: true, index: true },
    tasksetName: { type: String, default: "" },
    triggeredBy: { type: String, default: "teacher" }, // "teacher" | "auto"
    teacherNote: { type: String, default: "" }, // what the teacher typed
    totalTasks: { type: Number, default: 0 },
    issuesFound: { type: Number, default: 0 },
    issuesFixed: { type: Number, default: 0 },
    // Per-task diagnostic detail
    diagnostics: [
      {
        taskIndex: Number,
        taskType: String,
        title: String,
        errors: [String],       // validation errors found
        fixed: { type: Boolean, default: false },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

TaskDiagnosticLogSchema.index({ createdAt: -1 });

export default mongoose.models.TaskDiagnosticLog ||
  mongoose.model("TaskDiagnosticLog", TaskDiagnosticLogSchema);
