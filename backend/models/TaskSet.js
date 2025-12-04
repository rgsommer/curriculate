// models/TaskSet.js
import mongoose from "mongoose";

const { Schema } = mongoose;

// Display schema – physical objects/exhibits anchored to stations
const DisplaySchema = new Schema(
  {
    key: { type: String, required: true },        // unique within this TaskSet
    name: { type: String, required: true },       // "Van Gogh: Starry Night"
    description: { type: String },                // short description for students
    stationColor: { type: String },               // "red", "blue", "green", etc.
    notesForTeacher: { type: String },            // setup notes, only for teacher UI
    imageUrl: { type: String },                   // optional reference image
  },
  { _id: false }
);

// Task item schema – used for multi-question tasks (MC/TF/SA groups, etc.)
const TaskItemSchema = new Schema(
  {
    prompt: { type: String, required: true },     // sub-question text
    options: [String],                            // for MCQ / TF if needed
    correctAnswer: Schema.Types.Mixed,            // index, string, or boolean
    points: { type: Number },                     // optional per-item override
  },
  { _id: false }
);

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

    // NEW: Multi-question support – MC/TF/SA groups, etc.
    // If present, this task represents several related items that should be
    // presented together on the student device.
    items: [TaskItemSchema],

    // Link this task to a physical display (optional)
    // Should match one of TaskSet.displays[].key if used
    displayKey: { type: String },

    // EXTRA fields for AI-generated structure (optional)
    order: Number,                      // task sequence within a set
    timeMinutes: Number,                // estimated time per task
    movement: { type: Boolean, default: false },         // Body Break, move-around
    requiresDrawing: { type: Boolean, default: false },  // drawing/mime tasks
    notesForTeacher: String,            // AI teacher notes, not shown to students

    // Optional AI metadata for future use
    aiMetadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false }
);

// TaskSet schema
const TaskSetSchema = new Schema(
  {
    // Original fields
    name: { type: String, required: true }, // display name for list page
    ownerId: { type: Schema.Types.ObjectId, ref: "User" },

    // 🔐 Location binding for QR codes and station sets
    //
    // locationKey: lowercase logical key used in Presenter profile
    // example: "classroom-201", "gym-east"
    locationKey: { type: String },

    // Optional descriptions / notes
    description: { type: String },

    // Displays bound to this TaskSet (for Anchored Display mode & museum mode)
    displays: [DisplaySchema],

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
    avgScorePercent: { type: Number, default: null },     // 0–100
  },
  { timestamps: true }
);

const TaskSet = mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;
