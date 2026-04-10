// backend/services/taskTypeTimingAggregator.js
// Processes room.submissions at session end and upserts TaskTypeStats documents
// for both the global pool and the teacher-specific pool.
//
// Called from the "teacher:endSessionAndEmail" handler in index.js.

import TaskTypeStats from "../models/TaskTypeStats.js";
import { TASK_TYPE_META } from "../../shared/taskTypes.js";

const GLOBAL_OWNER = "__global__";

// Outlier guard: ignore submissions faster than 1s or slower than 20 min.
// These are almost certainly mis-fires, reloads, or AFK students.
const MIN_MS = 1_000;
const MAX_MS = 20 * 60 * 1000;

/**
 * Aggregate timing data from a completed session's submissions.
 *
 * @param {Array}  submissions  - room.submissions array (each has taskType via task lookup, timeMs, etc.)
 * @param {Array}  tasks        - room.taskset.tasks array (for taskType + maxTimeSeconds lookup)
 * @param {string} ownerId      - teacher's ownerId (for per-teacher stats)
 */
export async function aggregateTimingStats(submissions, tasks, ownerId) {
  if (!Array.isArray(submissions) || !submissions.length) return;
  if (!Array.isArray(tasks)) return;

  // Build a map of taskIndex → task metadata
  const taskByIndex = new Map();
  tasks.forEach((t, i) => {
    const taskType = t?.taskType || t?.type || null;
    if (taskType) {
      taskByIndex.set(i, {
        taskType,
        maxTimeSeconds: Number(t?.timeLimitSeconds || t?.maxTimeSeconds || TASK_TYPE_META?.[taskType]?.maxTimeSeconds) || 0,
      });
    }
  });

  // Group valid timeMs values by taskType
  const byType = {};
  for (const sub of submissions) {
    const timeMs = Number(sub?.timeMs);
    if (!Number.isFinite(timeMs) || timeMs < MIN_MS || timeMs > MAX_MS) continue;

    const taskIndex = sub?.taskIndex;
    const taskMeta = taskByIndex.get(taskIndex);
    if (!taskMeta) continue;

    const { taskType, maxTimeSeconds } = taskMeta;
    if (!byType[taskType]) byType[taskType] = [];
    byType[taskType].push({ timeMs, maxTimeSeconds });
  }

  // Upsert stats for each task type — both global and per-teacher
  const owners = [GLOBAL_OWNER];
  if (ownerId && ownerId !== GLOBAL_OWNER) owners.push(String(ownerId));

  const ops = [];
  for (const [taskType, samples] of Object.entries(byType)) {
    const totalMs = samples.reduce((s, x) => s + x.timeMs, 0);
    const count = samples.length;
    const minMs = Math.min(...samples.map((x) => x.timeMs));
    const maxMs = Math.max(...samples.map((x) => x.timeMs));
    const withinLimit = samples.filter(
      (x) => x.maxTimeSeconds > 0 && x.timeMs <= x.maxTimeSeconds * 1000
    ).length;

    for (const owner of owners) {
      ops.push(
        TaskTypeStats.findOneAndUpdate(
          { ownerId: owner, taskType },
          {
            $inc: {
              sampleCount: count,
              totalMs,
              withinLimitCount: withinLimit,
            },
            $min: { minMs },
            $max: { maxMs },
            $set: { lastUpdatedAt: new Date() },
          },
          { upsert: true, new: true }
        ).then((doc) => {
          // Recompute avgMs from the running totals
          if (doc && doc.sampleCount > 0) {
            doc.avgMs = Math.round(doc.totalMs / doc.sampleCount);
            return doc.save();
          }
        })
      );
    }
  }

  try {
    await Promise.all(ops);
  } catch (err) {
    console.error("[TaskTypeTimingAggregator] Failed to upsert stats:", err?.message || err);
  }
}

/**
 * Retrieve timing stats for use in the AI generator prompt or taskset listing.
 * Returns per-teacher stats when available (≥ 10 samples), falling back to global.
 *
 * @param {string} [ownerId] - teacher's ownerId (omit for global-only)
 * @returns {Object} Map of taskType → { avgMs, avgSeconds, avgMinutes, sampleCount }
 */
export async function getTimingStatsForGenerator(ownerId) {
  // Always fetch global
  const globalDocs = await TaskTypeStats.find({ ownerId: GLOBAL_OWNER }).lean();
  const globalMap = new Map(globalDocs.map((d) => [d.taskType, d]));

  // If ownerId given, fetch teacher-specific and prefer when ≥ 10 samples
  let teacherMap = new Map();
  if (ownerId && ownerId !== GLOBAL_OWNER) {
    const teacherDocs = await TaskTypeStats.find({ ownerId }).lean();
    teacherMap = new Map(teacherDocs.map((d) => [d.taskType, d]));
  }

  const result = {};
  const allTypes = new Set([...globalMap.keys(), ...teacherMap.keys()]);
  for (const taskType of allTypes) {
    const teacher = teacherMap.get(taskType);
    const global = globalMap.get(taskType);

    // Prefer teacher data if they have enough samples
    const doc = (teacher && teacher.sampleCount >= 10) ? teacher : (global || teacher);
    if (!doc || doc.sampleCount === 0) continue;

    const avgMs = doc.avgMs || Math.round(doc.totalMs / doc.sampleCount);
    result[taskType] = {
      avgMs,
      avgSeconds: Math.round(avgMs / 1000),
      avgMinutes: +(avgMs / 60000).toFixed(1),
      sampleCount: doc.sampleCount,
      source: doc.ownerId === GLOBAL_OWNER ? "global" : "teacher",
    };
  }

  return result;
}
