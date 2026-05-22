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

    options: [String],                  // for MCQ / simple lists
      correctAnswer: Schema.Types.Mixed,  // index, string, boolean, etc.
      mediaUrl: String,
      timeLimitSeconds: Number,
      points: { type: Number, default: 10 },

      // 🔹 Arbitrary task configuration (used by SORT, SEQUENCE, etc.)
      config: {
        type: Schema.Types.Mixed,
        default: {},
      },

      // 🔹 Multi-question support – MC/TF/SA groups, timelines, etc.
      // Using Mixed for flexibility so AI/other tasks can shape items as needed.
      items: {
        type: [Schema.Types.Mixed],
        default: [],
      },

      // 🔹 Sequence / Timeline fields (set by normalizer, must be in schema to persist)
      correctOrder: { type: [String], default: undefined },  // ordered item IDs for scoring
      sequence: { type: [Schema.Types.Mixed], default: undefined }, // alias for items in seq/timeline

      // 🔹 Matching task fields (set by normalizer)
      leftItems: { type: [Schema.Types.Mixed], default: undefined },
      rightItems: { type: [Schema.Types.Mixed], default: undefined },
      correctMatches: { type: Schema.Types.Mixed, default: undefined },

      // 🔹 Reading-comp / sort / draw-mime fields (set by normalizer)
      passage: { type: String },              // reading passage text
      categories: { type: [Schema.Types.Mixed], default: undefined }, // sort bucket labels
      clues: { type: [Schema.Types.Mixed], default: undefined }, // draw-mime clue words OR brain-blitz {clue,answer} objects
      notes: { type: Schema.Types.Mixed, default: undefined }, // brain-spark-notes content

    // Link this task to a physical display (optional)
    // Should match one of TaskSet.displays[].key if used
    displayKey: { type: String },

    // 🔹 Quest Mode bonus/hidden/coin metadata.
    //   These fields are inert unless the taskset has `questModeEnabled: true`
    //   (set by the generator). They are used by:
    //     - backend/services/questEconomy.js (coinReward / resourceReward)
    //     - backend/services/questUnlocks.js (isBonus, isHidden, unlockConditions)
    //     - student-app QuestHud + TaskRunner (gating render)
    //   When questModeEnabled is false, requiredForCompletion defaults to true and
    //   every other field stays falsy — non-quest tasksets are entirely unaffected.
    isBonus:                { type: Boolean, default: false },
    isHidden:               { type: Boolean, default: false },
    requiredForCompletion:  { type: Boolean, default: true },
    unlockConditions:       { type: Schema.Types.Mixed, default: null },
    coinReward:             { type: Number, default: null },           // null → fall back to base task points
    resourceReward:         { type: Schema.Types.Mixed, default: null }, // e.g. { rope: 2 }
    qualityThreshold:       { type: Number, default: null },
    questEffects:           { type: Schema.Types.Mixed, default: null },

    // EXTRA fields for AI-generated structure (optional)
    order: Number,                      // task sequence within a set
    timeMinutes: Number,                // estimated time per task
    movement: { type: Boolean, default: false },         // Body Break, move-around
    requiresDrawing: { type: Boolean, default: false },  // drawing/mime tasks
    notesForTeacher: String,            // AI teacher notes, not shown to students

    isPublic: { type: Boolean, default: false },
    shareCode: { type: String, unique: true, sparse: true }, // Optional, generated when teacher enables sharing
    
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

    // When true, this taskset was generated explicitly for an at-desk
    // (no scanning, no walking) classroom — the generator excluded
    // movement-required task types from the pool, and the LiveSession
    // launch panel will default the per-session 'On-screen only'
    // checkbox to true.  Keeps the design intent visible at run time.
    atDeskOnly: { type: Boolean, default: false },

    // Quest Mode overlay. Activated when the taskset contains at least one
    // `quest` task; the generator sets this explicitly so the LiveSession layer
    // can switch on the QuestHud / coin economy without inspecting every task.
    //
    // `questConfig` is optional taskset-wide config (theme, default resource
    // tiers, premium-resource definitions, etc). Per-quest config still lives
    // on each individual quest-task's `config` field.
    //
    // See QUEST_MODE_PLAN.md §3 for the full data model.
    questModeEnabled: { type: Boolean, default: false },
    questConfig:      { type: Schema.Types.Mixed, default: null },

    // Escape Room overlay. Activated when escapeRoomConfig != null.
    // Carries locks, keys, fragments, narrativeBeats — see ESCAPE_ROOM_PLAN.md §4a.
    // The lock-evaluation engine reads + mutates per-team state stored in the
    // separate EscapeRoomTeamState model (added in a follow-up commit).
    escapeRoomConfig: { type: Schema.Types.Mixed, default: null },

    // Whodunnit overlay. Activated when mysteryEnabled === true.
    // Per-session runtime state lives on a separate MysterySession document
    // (added in a follow-up commit); this field carries config defaults only.
    //
    // See WHODUNNIT_PLAN.md §3a for the full data model.
    mysteryEnabled:   { type: Boolean, default: false },
    mysteryConfig:    { type: Schema.Types.Mixed, default: null },

    // Duel system — auto-triggered head-to-head when two teams are neck-and-neck.
    // Activated when duelsEnabled === true on a taskset. Duels are NOT teacher-
    // triggered; the server fires them automatically when score parity and a
    // cooldown both hold. See backend/services/duel.js.
    duelsEnabled:           { type: Boolean, default: false },
    duelTieThresholdPts:    { type: Number,  default: 10 },        // top-2 gap to qualify
    duelCooldownMs:         { type: Number,  default: 4 * 60 * 1000 },

    // LevelUp — early-finisher upgrade. When enabled, after a team completes
    // all core + the 2 always-on bonus tasks, they may re-attempt their
    // lowest-scored task with a freshly generated AI variant. Scoring policy
    // is MAX(original, retry). See LEVEL_UP_PLAN.md for the full spec.
    levelUpEnabledByDefault: { type: Boolean, default: true },

    tasks: [TaskSchema],
    isPublic: { type: Boolean, default: false },

    // AI metadata – for generated sets
    gradeLevel: String,
    subject: String,
    difficulty: String,
    durationMinutes: Number,
    learningGoal: String, // REVIEW / INTRODUCTION / ENRICHMENT / ASSESSMENT

    // AI generation metadata (report, coverage, concept allocation)
    meta: { type: Schema.Types.Mixed, default: null },

    // Grading configuration — teacher sets the total for gradebook
    gradingConfig: {
      enabled: { type: Boolean, default: false },
      maxGrade: { type: Number, default: 100 },         // "out of X" (e.g., 50, 25, 100)
      letterGradeScale: {
        type: [{ min: Number, letter: String }],         // e.g., [{ min: 90, letter: "A" }, { min: 80, letter: "B" }, ...]
        default: [
          { min: 90, letter: "A" },
          { min: 80, letter: "B" },
          { min: 70, letter: "C" },
          { min: 60, letter: "D" },
          { min: 0, letter: "F" },
        ],
      },
    },

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
