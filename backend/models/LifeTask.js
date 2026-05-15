// backend/models/LifeTask.js
//
// A personal to-do item used by the /tasks app on www.curriculate.net/tasks.
// Intentionally separate from the scavenger-hunt "TaskSet" / "Task" concepts.
import mongoose from "mongoose";

const { Schema } = mongoose;

export const LIFE_TASK_CATEGORIES = ["work", "family", "church"];

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
  },
  { timestamps: true }
);

LifeTaskSchema.index({ userId: 1, completedAt: 1, dueAt: 1, createdAt: 1 });

const LifeTask =
  mongoose.models.LifeTask || mongoose.model("LifeTask", LifeTaskSchema);

export default LifeTask;
