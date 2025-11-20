// models/TaskSet.js
import mongoose from "mongoose";

const { Schema } = mongoose;

// Individual Task schema
const TaskSchema = new Schema(
  {
    taskId: String,                      // your existing field
    title: String,                       // short label for the task
    prompt: { type: String, required: true },
    taskType: { type: String, required: true }, // mcq, true_false, sequence, etc.

    options: [String],                  // for MCQ / SORT etc.
    correctAnswer: Schema.Types.Mixed,  // was "answer" → now "correctAnswer"
    mediaUrl: String,
    timeLimitSeconds: Number,
    points: { type: Number, default: 10 },

    // EXTRA fields for AI-generated structure (optional)
    order: Number,                      // task sequence within a set
    timeMinutes: Number,                // estimated time per task
    movement: { type: Boolean, default: false },         // Body Break, move-around
    requiresDrawing: { type: Boolean, default: false },  // drawing/mime tasks
    notesForTeacher: String             // AI teacher notes, not shown to students
  },
  { _id: false }
);

// TaskSet schema
const TaskSetSchema = new Schema(
  {
    // Original fields
    name: { type: String, required: true }, // display name for list page
    ownerId: { type: Schema.Types.ObjectId, ref: "User" },
    tasks: [TaskSchema],
    isPublic: { type: Boolean, default: false },

    // AI metadata – for generated sets
    gradeLevel: String,
    subject: String,
    difficulty: String,
    durationMinutes: Number,
    learningGoal: String, // REVIEW / INTRODUCTION / ENRICHMENT / ASSESSMENT

    // Analytics fields (2.1)
    lastPlayedAt: Date,
    totalPlays: { type: Number, default: 0 },
    totalPlayers: { type: Number, default: 0 },

    avgEngagementScore: { type: Number, default: null }, // 0–1 or 0–100; be consistent
    completionRate: { type: Number, default: null },      // 0–1 or 0–100; be consistent
    avgScorePercent: { type: Number, default: null }      // 0–100
  },
  { timestamps: true }
);

const TaskSet = mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;
