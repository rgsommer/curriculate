import mongoose from "mongoose";
const { Schema } = mongoose;

const PerTaskSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: "Task" },
  type: String,
  prompt: String,
  points: Number,
  isCorrect: Boolean,
  latencyMs: Number,
});

const StudentSessionAnalyticsSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classroomId: { type: Schema.Types.ObjectId, ref: "Classroom" },

    studentName: String,

    totalPoints: Number,
    maxPoints: Number,
    accuracyPct: Number,
    tasksCompleted: Number,
    tasksAssigned: Number,
    avgLatencyMs: Number,

    perTask: [PerTaskSchema],
  },
  { timestamps: true }
);

const StudentSessionAnalytics = mongoose.model(
  "StudentSessionAnalytics",
  StudentSessionAnalyticsSchema
);

export default StudentSessionAnalytics;
