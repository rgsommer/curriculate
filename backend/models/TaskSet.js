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
    imageUrl: { type: String }                    // optional reference image
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

    // Link this task to a physical display (optional)
    // Should match one of TaskSet.displays[].key if used
    displayKey: { type: String },

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

    // 🔐 Location binding for QR codes and station sets
    //
    // locationKey: lowercase logical key used by backend ("classroom", "hallway", "room-206")
    // locationCode: proper-case code used in QR URLs ("Classroom", "Hallway", "Room-206")
    //
    // Example QR: https://api.curriculate.net/Classroom/red
    //   → rawLocationCode = "Classroom"
    //   → must match taskset.locationCode exactly (case-sensitive)
    locationKey: {
      type: String,
      default: "classroom", // logical type
    },
    locationCode: {
      type: String,
      default: "Classroom", // what actually appears in the QR path segment
    },

    // New: physical / anchored displays for this task set
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
    avgScorePercent: { type: Number, default: null }      // 0–100
  },
  { timestamps: true }
);

const TaskSet = mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;
