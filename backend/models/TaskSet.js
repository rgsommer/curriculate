// backend/models/TaskSet.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const DisplaySchema = new Schema(
  {
    key: { type: String, required: [true, "Display key is required"] },
    name: { type: String, required: [true, "Display name is required"] },
    description: String,
    stationColor: String,
    notesForTeacher: String,
    imageUrl: String,
  },
  { _id: false }
);

const TaskSchema = new Schema(
  {
    taskId: String,
    title: String,
    prompt: { type: String, required: [true, "Task prompt is required"] },

    // IMPORTANT:
    // We deliberately do NOT enforce an enum here, because the
    // canonical list of IDs lives in shared/taskTypes.js and the
    // AI / editor logic. This avoids 500s when new taskTypes
    // like "brainstorm-battle" are added there.
    taskType: {
      type: String,
      required: [true, "taskType is required"],
    },

    options: [Schema.Types.Mixed],
    correctAnswer: Schema.Types.Mixed,
    mediaUrl: String,
    timeLimitSeconds: Number,
    points: { type: Number, default: 10 },
    displayKey: String,
    ignoreNoise: { type: Boolean, default: false },

    // NEW: Only enforce QR location for specific tasks (e.g. scavenger hunt)
    enforceLocation: {
      type: Boolean,
      default: false,
      description: "If true, QR scan must include correct locationKey (e.g. 'gym')",
    },

    // Optional: let teacher explicitly set required location per task
    requiredLocation: {
      type: String,
      default: "any",
      enum: ["any", "classroom", "hallway", "gym", "library", "playground", "room-212", "room-211", "cafeteria", "courtyard"],
    },

    // Keep this as a flexible blob for now.
    jeopardyConfig: Schema.Types.Mixed,

    order: Number,
    timeMinutes: Number,
    movement: { type: Boolean, default: false },
    requiresDrawing: { type: Boolean, default: false },
    notesForTeacher: String,
  },
  { _id: false }
);

const TaskSetSchema = new Schema(
  {
    name: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User" },

    // Location / room metadata
    locationKey: { type: String, default: "classroom" },
    locationCode: { type: String, default: "Classroom" },

    // Displays + tasks
    displays: [DisplaySchema],
    tasks: [TaskSchema],

    isPublic: { type: Boolean, default: false },

    // Optional meta used by analytics / filters
    gradeLevel: String,
    subject: String,
    difficulty: String,
    durationMinutes: Number,
    learningGoal: String,

    // Analytics roll-ups
    lastPlayedAt: Date,
    totalPlays: { type: Number, default: 0 },
    totalPlayers: { type: Number, default: 0 },
    avgEngagementScore: Number,
    completionRate: Number,
    avgScorePercent: Number,
  },
  { timestamps: true }
);

const TaskSet =
  mongoose.models.TaskSet || mongoose.model("TaskSet", TaskSetSchema);

export default TaskSet;
