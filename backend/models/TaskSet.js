// backend/models/TaskSet.js
import mongoose from "mongoose";

const taskSchema = new mongoose.Schema({
  stationId: Number,
  type: String, // mcq, speakPrompt, matchImage, matchText, performanceTask, experimentStep, physical, openResponse
  prompt: String,
  subject: String,
  data: mongoose.Schema.Types.Mixed, // choices, imageUrl, audioUrl, recordMode, etc.
  scoring: mongoose.Schema.Types.Mixed, // { mode, points, minConfidence }
});

const taskSetSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: String,
    description: String,
    isPublic: { type: Boolean, default: false },
    tasks: [taskSchema],
    usageStats: {
      lastPlayedAt: Date,
      totalPlays: { type: Number, default: 0 },
      totalStudents: { type: Number, default: 0 },
      rating: { type: Number, default: 0 },
    }
  },
  { timestamps: true }
);

export default mongoose.model("TaskSet", taskSetSchema);
