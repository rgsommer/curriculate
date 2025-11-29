// backend/models/TaskSet.js
import mongoose from "mongoose";

const { Schema } = mongoose;

// Display schema – fixed
const DisplaySchema = new Schema({
  key: { type: String, required: [true, "Display key is required"] },
  name: { type: String, required: [true, "Display name is required"] },
  description: String,
  stationColor: String,
  notesForTeacher: String,
  imageUrl: String,
}, { _id: false });

// Task schema – ALL required: true → [true, "..."]
const TaskSchema = new Schema({
  taskId: String,
  title: String,
  prompt: {
    type: String,
    required: [true, "Task prompt is required"],
  },
  taskType: {
    type: String,
    required: [true, "taskType is required"],
    enum: {
      values: [
        "multiple_choice","true-false","short-answer","open-text","sort","sequence","matching","fill-in-the-blank","jeopardy",
        "photo","make-and-snap","audio-recording","video-clip","draw","pet-feeding","brain-spark-notes","flashcards",
        "body-break","motion-mission","around-the-room-scavenger","station-physical-challenge",
        "mad-dash-sequence","true-false-tictactoe","live-debate","mystery-clues","collaborative-swap","three-card-reveal",
        "random-treat","timeline","mind-mapper","scan-and-confirm","hidenseek"
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

  jeopardyConfig: {
    boardTitle: String,
    aiNotes: String,
    categories: [{
      title: String,
      clues: [{
        value: Number,
        prompt: String,
        answer: String,
      }],
    }],
    hidenseekClues: [{
      taskIndex: Number,
      clue: String,
      required: [true, "HideNSeek clue is required"]   // ← THIS WAS THE CULPRIT
    }]
  },

  order: Number,
  timeMinutes: Number,
  movement: { type: Boolean, default: false },
  requiresDrawing: { type: Boolean, default: false },
  notesForTeacher: String
}, { _id: false });

// Main TaskSet schema
const TaskSetSchema = new Schema({
  name: { type: String, required: true },  // top-level is still safe with shorthand

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

// Safe model registration
const TaskSet = mongoose.models.TaskSet || mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;