// backend/models/LifeTask.js
//
// A personal to-do item used by the /tasks app on www.curriculate.net/tasks.
// Intentionally separate from the scavenger-hunt "TaskSet" / "Task" concepts.
import mongoose from "mongoose";

const { Schema } = mongoose;

export const LIFE_TASK_CATEGORIES = ["work", "family", "church"];
export const LIFE_TASK_RECURRENCES = ["none", "weekly", "monthly", "yearly"];

const LifeTaskSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      enum: LIFE_TASK_CATEGORIES,
      default: "family",
      index: true,
    },
    // Optional "do this by" date. Sorting prefers dueAt asc, then createdAt asc.
    dueAt: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
    // "weekly" / "monthly" / "yearly" / "none". On complete, a recurring
    // task auto-spawns a fresh sibling with dueAt advanced by the interval.
    // Each occurrence is its own document so the Completed tab keeps a
    // history of every time the task was finished.
    recurrence: {
      type: String,
      enum: LIFE_TASK_RECURRENCES,
      default: "none",
    },
    // For monthly recurrence only: pin the day of the month.
    //   null        = auto (use the day from dueAt — original behavior)
    //   1..31       = land on that day each month (clamped to month length,
    //                 e.g. 31 → Feb 28)
    //   0           = last day of the month
    // Ignored for other recurrences. Mutually exclusive with the
    // weekday+ordinal pair below: if those are set, this is treated as null.
    recurrenceDay: {
      type: Number,
      default: null,
      min: 0,
      max: 31,
    },
    // Alternative monthly pin: "Nth weekday of the month" (e.g. 3rd Sunday).
    //   recurrenceWeekday: 0..6 (Sunday=0) or null
    //   recurrenceOrdinal: 1..5 = that occurrence in the month
    //                      -1   = last occurrence in the month
    //                      null = not set
    // Only honoured when recurrence === "monthly". If a chosen ordinal
    // doesn't exist in a particular month (e.g. "5th Sunday" of a month
    // with only 4 Sundays) the spawn falls back to that month's LAST
    // occurrence of that weekday.
    recurrenceWeekday: {
      type: Number,
      default: null,
      min: 0,
      max: 6,
    },
    recurrenceOrdinal: {
      type: Number,
      default: null,
      min: -1,
      max: 5,
    },
  },
  { timestamps: true }
);

LifeTaskSchema.index({ userId: 1, completedAt: 1, dueAt: 1, createdAt: 1 });

const LifeTask =
  mongoose.models.LifeTask || mongoose.model("LifeTask", LifeTaskSchema);

export default LifeTask;
