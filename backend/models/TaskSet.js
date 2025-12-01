// backend/models/TaskSet.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const DisplaySchema = new Schema({
  key: { type: String, required: [true, "Display key is required"] },
  name: { type: String, required: [true, "Display name is required"] },
  description: String,
  stationColor: String,
  notesForTeacher: String,
  imageUrl: String,
}, { _id: false });

const TaskSchema = new Schema({
  taskId: String,
  title: String,
  prompt: { type: String, required: [true, "Task prompt is required"] },
  taskType: {
    type: String,
    required: [true, "taskType is required"],
    enum: {
      values: [
        // === Canonical types from shared/taskTypes.js (with hyphens) ===
        "multiple-choice",        // ← fixed: was underscore
        "true-false",
        "short-answer",
        "sort",
        "sequence",
        "photo",
        "make-and-snap",
        "body-break",
        "jeopardy",
        "flashcards",
        "timeline",
        "brainstorm-battle",
        "mind-mapper",
        "speed-draw",
        "pet-feeding",
        "motion-mission",
        "live-debate",
        "mystery-clues",
        "hidenseek",

        // === Newly added canonical ones (were missing) ===
        "collaboration",
        "musical-chairs",
        "mad-dash",

        // === Existing legacy / extended types you already use ===
        "open-text",
        "matching",
        "fill-in-the-blank",
        "audio-recording",
        "video-clip",
        "draw",
        "brain-spark-notes",
        "mad-dash-sequence",
        "true-false-tictactoe",
        "collaborative-swap",
        "three-card-reveal",
        "random-treat",
        "around-the-room-scavenger",
        "station-physical-challenge",
        "scan-and-confirm",
      ],
      message: "Invalid taskType: {VALUE}",
    },
  },

  options: [String],
  correctAnswer: Schema.Types.Mixed,
  mediaUrl: String,
  timeLimitSeconds: Number,
  points: { type: Number, default: 10 },
  displayKey: String,
  ignoreNoise: { type: Boolean, default: false },
  jeopardyConfig: { /* unchanged */ },
  order: Number,
  timeMinutes: Number,
  movement: { type: Boolean, default: false },
  requiresDrawing: { type: Boolean, default: false },
  notesForTeacher: String,
}, { _id: false });

const TaskSetSchema = new Schema({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User" },
  locationKey: { type: String, default: "classroom" },
  locationCode: { type: String, default: "Classroom" },
  displays: [DisplaySchema],
  tasks: [TaskSchema],
  isPublic: { type: Boolean, default: false },
  gradeLevel: String,
  subject: String,
  difficulty: String,
  durationMinutes: Number,
  learningGoal: String,
  lastPlayedAt: Date,
  totalPlays: { type: Number, default: 0 },
  totalPlayers: { type: Number, default: 0 },
  avgEngagementScore: Number,
  completionRate: Number,
  avgScorePercent: Number,
}, { timestamps: true });

const TaskSet = mongoose.models.TaskSet || mongoose.model("TaskSet", TaskSetSchema);
export default TaskSet;