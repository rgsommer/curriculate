// backend/models/TaskTypeStats.js
// Stores running averages of actual student completion times per task type.
// Two scopes:  global (ownerId = "__global__")  and  per-teacher (ownerId = <teacher id>).
// Updated at session end from room.submissions data.
import mongoose from "mongoose";

const { Schema } = mongoose;

const TaskTypeStatsSchema = new Schema(
  {
    // "__global__" for the cross-platform average, or a teacher's ownerId
    ownerId: { type: String, required: true, index: true },

    taskType: { type: String, required: true, index: true },

    // Running count & total for incremental mean calculation
    sampleCount: { type: Number, default: 0 },        // number of valid timeMs submissions
    totalMs:     { type: Number, default: 0 },         // sum of all timeMs values

    // Precomputed average (updated on each upsert for fast reads)
    avgMs:       { type: Number, default: 0 },         // totalMs / sampleCount

    // Distribution info for outlier filtering & insight
    minMs:       { type: Number, default: null },
    maxMs:       { type: Number, default: null },

    // Percentile-ish bucket: how many finished under the hardcoded maxTimeSeconds
    withinLimitCount: { type: Number, default: 0 },    // finished within the task type's maxTimeSeconds

    // Last updated (for cache invalidation / freshness)
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Compound unique: one doc per (ownerId, taskType)
TaskTypeStatsSchema.index({ ownerId: 1, taskType: 1 }, { unique: true });

const TaskTypeStats = mongoose.model("TaskTypeStats", TaskTypeStatsSchema);

export default TaskTypeStats;
