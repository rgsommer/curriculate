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

// Individual Task schema
const TaskSchema = new Schema(
  {
    taskId: String,
    title: String,
    prompt: { type: String, required: true },  // ← fixed: closed properly
    taskType: {
      type: String,
      required: true,
      enum: {
        values: [
            // === Core Academic (9) ===
            "multiple_choice",
            "true-false",
            "short-answer",
            "open-text",
            "sort",
            "sequence",
            "matching",
            "fill-in-the-blank",
            "jeopardy",

            // === Evidence & Creative (8) ===
            "photo",
            "make-and-snap",
            "audio-recording",
            "video-clip",
            "draw",
            "pet-feeding",
            "brain-spark-notes",
            "flashcards",

            // === Physical / Movement (4) ===
            "body-break",
            "motion-mission",
            "around-the-room-scavenger",
            "station-physical-challenge",

            // === Competitive / Game-Based (8) ===
            "mad-dash-sequence",
            "true-false-tictactoe",
            "live-debate",
            "mystery-clues",
            "collaborative-swap",
            "three-card-reveal",
            "random-treat",
            "timeline",

            // === Advanced / Special (3) ===
            "mind-mapper",
            "scan-and-confirm", // meta task
            "hidenseek"
        ],
        message: "Invalid taskType: {VALUE}",
      },
    },
    // ... rest of fields
  },
  { _id: false }
);

    options: [String],                  // for MCQ / SORT etc.
    correctAnswer: Schema.Types.Mixed,  // was "answer" → now "correctAnswer"
    mediaUrl: String,
    timeLimitSeconds: Number,
    points: { type: Number, default: 10 },

    // Link this task to a physical display (optional)
    // Should match one of TaskSet.displays[].key if used
    displayKey: { type: String },

    // Per-task ambient-noise override
    // If true, this task will be ignored by the dimming/ambient-noise system
    ignoreNoise: { type: Boolean, default: false },

    // Jeopardy-style board configuration (optional).
    // For non-Jeopardy tasks this remains undefined.
    jeopardyConfig: {
      boardTitle: String,          // "Confederation Showdown", etc.
      aiNotes: String,             // instructions for AI board generation
      categories: [
        {
          title: String,           // category name
          clues: [
            {
              value: Number,       // e.g. 100, 200, 300…
              prompt: String,      // the clue text
              answer: String,      // expected answer (for AI or manual scoring)
            },
          ],
        },
      ],
      hidenseekClues: [{
        taskIndex: Number,     // which HideNSeek task (in case of multiple)
        clue: String,
        required: true
      }]
    },

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
    avgScorePercent: { type: Number, default: null },     // 0–100
  },
  { timestamps: true }
);

const TaskSet = mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;
