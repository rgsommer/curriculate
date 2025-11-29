// backend/models/TaskSet.js
import mongoose from "mongoose";

const { Schema } = mongoose;

// Display schema – physical objects/exhibits anchored to stations
const DisplaySchema = new Schema(
  {
    key: { type: String, required: true },        // unique within this TaskSet
    name: { type: String, required: true },
    description: { type: String },
    stationColor: { type: String },
    notesForTeacher: { type: String },
    imageUrl: { type: String },
  },
  { _id: false }
);

// Individual Task schema – ALL fields must be inside the object passed to new Schema()
const TaskSchema = new Schema(
  {
    taskId: String,
    title: String,
    prompt: { type: String, required: true },

    taskType: {
      type: String,
      required: true,
      enum: {
        values: [
          // Core Academic
          "multiple_choice", "true-false", "short-answer", "open-text",
          "sort", "sequence", "matching", "fill-in-the-blank", "jeopardy",

          // Evidence & Creative
          "photo", "make-and-snap", "audio-recording", "video-clip", "draw",
          "pet-feeding", "brain-spark-notes", "flashcards",

          // Physical / Movement
          "body-break", "motion-mission", "around-the-room-scavenger",
          "station-physical-challenge",

          // Competitive / Game-Based
          "mad-dash-sequence", "true-false-tictactoe", "live-debate",
          "mystery-clues", "collaborative-swap", "three-card-reveal",
          "random-treat", "timeline",

          // Advanced / Special
          "mind-mapper", "scan-and-confirm", "hidenseek"
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
      categories: [
        {
          title: String,
          clues: [
            {
              value: Number,
              prompt: String,
              answer: String,
            },
          ],
        },
      ],
      hidenseekClues: [{
        taskIndex: Number,
        clue: String,
        required: true
      }]
    },

    // AI / structure fields
    order: Number,
    timeMinutes: Number,
    movement: { type: Boolean, default: false },
    requiresDrawing: { type: Boolean, default: false },
    notesForTeacher: String
  },
  { _id: false }
);

// Main TaskSet schema
const TaskSetSchema = new Schema(
  {
    name: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User" },

    locationKey: { type: String, default: "classroom" },
    locationCode: { type: String, default: "Classroom" },

    displays: [DisplaySchema],
    tasks: [TaskSchema],

    isPublic: { type: Boolean, default: false },

    // AI metadata
    gradeLevel: String,
    subject: String,
    difficulty: String,
    durationMinutes: Number,
    learningGoal: String,

    // Analytics
    lastPlayedAt: Date,
    totalPlays: { type: Number, default: 0 },
    totalPlayers: { type: Number, default: 0 },
    avgEngagementScore: Number,
    completionRate: Number,
    avgScorePercent: Number,
  },
  { timestamps: true }
);

// Safety guard – prevents "OverwriteModelError" on hot reload
const TaskSet = mongoose.models.TaskSet || mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;