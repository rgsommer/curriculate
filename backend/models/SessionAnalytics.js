import mongoose from "mongoose";
const { Schema } = mongoose;

const TaskSummarySchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: "Task" },
  type: String,
  prompt: String,
  avgScore: Number,
  avgCorrectPct: Number,
  submissionsCount: Number,
  avgLatencyMs: Number,
});

const TeamSummarySchema = new Schema({
  teamId: Schema.Types.ObjectId,
  teamName: String,
  totalPoints: Number,
  correctCount: Number,
  incorrectCount: Number,
  avgLatencyMs: Number,
});

const SessionAnalyticsSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classroomId: { type: Schema.Types.ObjectId, ref: "Classroom" },

    classAverageScore: Number,
    classAverageAccuracy: Number,

    tasks: [TaskSummarySchema],
    teams: [TeamSummarySchema],
  },
  { timestamps: true }
);

const SessionAnalytics = mongoose.model(
  "SessionAnalytics",
  SessionAnalyticsSchema
);

export default SessionAnalytics;
