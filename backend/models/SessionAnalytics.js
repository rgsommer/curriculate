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

const NoiseSummarySchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    threshold: { type: Number, default: 0 }, // 0–100
    brightness: { type: Number, default: 1 },

    // Aggregates (best-effort; depends on what the session stored)
    samplesCount: { type: Number, default: 0 },
    avgLevel: { type: Number, default: null }, // 0–100
    peakLevel: { type: Number, default: null }, // 0–100
    pctOverThreshold: { type: Number, default: null }, // 0–100
    durationSeconds: { type: Number, default: null },
    source: { type: String, default: "" }, // e.g., "room.noiseHistory"
  },
  { _id: false }
);

const SessionAnalyticsSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classroomId: { type: Schema.Types.ObjectId, ref: "Classroom" },

    classAverageScore: Number,
    classAverageAccuracy: Number,
    classAverageEngagement: Number,

    noiseSummary: { type: NoiseSummarySchema, default: () => ({}) },

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
