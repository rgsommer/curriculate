// teacher-app/src/utils/tasksetDuration.js
//
// Single source of truth for "how long should this taskset take?".
// Used by the EndTimeControl to pre-suggest a session end time.
//
// Strategy per task (first one that's defined wins):
//   1. task.estimatedMinutes (explicit override)
//   2. task.config?.estimatedMinutes
//   3. TASK_TYPE_META[task.taskType]?.estimatedMinutes (the per-type
//      default declared in shared/taskTypes.js)
//   4. fallback constant (DEFAULT_MIN)
//
// We also add a small per-task transition buffer to account for instruction
// reads, room changes, and grading overhead — it adds up across 8-10 tasks.

import { TASK_TYPE_META } from "@shared/taskTypes.js";

const DEFAULT_MIN = 4;
const TRANSITION_PER_TASK_MIN = 0.5;

/**
 * Estimated minutes for one task. Always rounded UP to a whole minute so
 * the sum doesn't drift fractional.
 */
export function getTaskEstimatedMinutes(task) {
  if (!task || typeof task !== "object") return DEFAULT_MIN;
  const direct = Number(task.estimatedMinutes);
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct);
  const cfg = Number(task?.config?.estimatedMinutes);
  if (Number.isFinite(cfg) && cfg > 0) return Math.ceil(cfg);
  const meta = TASK_TYPE_META?.[task.taskType]?.estimatedMinutes;
  if (Number.isFinite(meta) && meta > 0) return Math.ceil(meta);
  return DEFAULT_MIN;
}

/**
 * Total estimated minutes for a taskset. Accepts either the taskset
 * object (with .tasks) or an array of tasks directly.
 *
 * Returns 0 when nothing usable is passed in (caller renders without a
 * suggestion in that case).
 */
export function getTasksetEstimatedMinutes(tasksetOrTasks) {
  if (!tasksetOrTasks) return 0;
  const tasks = Array.isArray(tasksetOrTasks)
    ? tasksetOrTasks
    : Array.isArray(tasksetOrTasks?.tasks)
    ? tasksetOrTasks.tasks
    : [];
  if (tasks.length === 0) return 0;
  let total = 0;
  for (const t of tasks) {
    total += getTaskEstimatedMinutes(t) + TRANSITION_PER_TASK_MIN;
  }
  // Clamp to a sane range (10 min floor, 3-hour ceiling) so weird data
  // doesn't produce silly suggestions like "ends in 4 hours".
  return Math.max(10, Math.min(180, Math.round(total)));
}
