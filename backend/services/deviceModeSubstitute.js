// backend/services/deviceModeSubstitute.js
//
// Phase 1b — silent substitution of incompatible tasks at load / mode-change
// time. See docs/device-mode-architecture.md §4 — user decision:
//
//   "silent switch of activities, so no perceptible downgrade for teacher
//   or user, students will begin to prefer/demand tablets"
//
// Contract:
//   substituteTasksForRoom(room, deps) → { substitutionCount, log }
//
// Behavior:
//   - Snapshots room.tasksetOriginal on first invocation, so a subsequent
//     mode change can restore-then-resubstitute. Never mutates the caller's
//     original taskset object; only touches room.taskset.
//   - Runs the pure shared filter to find incompatible tasks.
//   - For each incompatible task, picks a category-appropriate compatible
//     replacement TYPE (see SUBSTITUTE_POOL), then calls the existing
//     regenerateSingleTask machinery to build a same-topic, same-vocab
//     replacement. Splices it into the taskset at the same index.
//   - If regenerateSingleTask throws (LLM outage, quality guardrail, etc.),
//     falls back to the next candidate type. If all fallbacks fail, drops
//     the task from the taskset (session gets shorter by one).
//   - No teacher-facing side effect: no error message, no toast, no
//     warning. The log is captured on room._deviceSubstitutionLog for
//     later analytics (Phase 4).
//
// This is server-only because regenerateSingleTask is heavy AI machinery.

import { filterTasksForDeviceMode } from "../../shared/deviceModeFilter.js";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

const SUBSTITUTE_POOL = {
  // Movement-flavoured but device-motion-free — matches the energy of
  // body-break and motion-mission with something that still gets teams
  // reacting.
  movement: [
    TASK_TYPES.BRAIN_BLITZ,
    TASK_TYPES.FLASHCARDS_RACE,
    TASK_TYPES.TRUTH_OR_DARE,
    TASK_TYPES.MYSTERY_CLUES,
    TASK_TYPES.FAKE_OUT,
  ],
  // Competitive replacement for hole-in-one — keep the head-to-head feel.
  competitive: [
    TASK_TYPES.BRAIN_BLITZ,
    TASK_TYPES.FLASHCARDS_RACE,
    TASK_TYPES.TRUE_FALSE_CONNECT_FOUR,
    TASK_TYPES.HANGMAN_DUEL,
  ],
  // Universal fallback if the original's category doesn't map above.
  default: [
    TASK_TYPES.MULTIPLE_CHOICE,
    TASK_TYPES.TRUE_FALSE,
    TASK_TYPES.BRAIN_BLITZ,
  ],
};

function pickCandidatesFor(originalTaskType) {
  const meta = TASK_TYPE_META[originalTaskType];
  const cat = String(meta?.category || "").toLowerCase();
  if (SUBSTITUTE_POOL[cat]) return SUBSTITUTE_POOL[cat];
  return SUBSTITUTE_POOL.default;
}

function buildRegenContext(taskset) {
  return {
    subject: taskset?.subject || taskset?.topicTitle || "General",
    gradeLevel: taskset?.gradeLevel || taskset?.grade || "middle school",
    difficulty: taskset?.difficulty || "medium",
    learningGoal: taskset?.learningGoal || taskset?.topicTitle || taskset?.name || "",
    topicLabel: taskset?.topicTitle || taskset?.topicLabel || taskset?.name || "",
    vocabularyLines: Array.isArray(taskset?.vocabulary)
      ? taskset.vocabulary
      : Array.isArray(taskset?.vocabularyLines)
      ? taskset.vocabularyLines
      : [],
    specialConsiderations: taskset?.specialConsiderations || "",
  };
}

/**
 * Restore the pre-substitution taskset (deep-cloned snapshot) if one
 * exists, and clear the substitution log. Called at the start of every
 * substitute pass so mode changes re-run cleanly.
 */
function restoreOriginalIfSnapshotted(room) {
  if (room._tasksetOriginalSnapshot) {
    // deep clone — don't share references with the frozen snapshot
    room.taskset = JSON.parse(JSON.stringify(room._tasksetOriginalSnapshot));
  }
  room._deviceSubstitutionLog = [];
}

/**
 * Take (or refresh) a deep snapshot of the current taskset. This is the
 * "as-authored" version we restore from on subsequent mode changes.
 */
function snapshotIfNeeded(room) {
  if (!room._tasksetOriginalSnapshot && room.taskset) {
    room._tasksetOriginalSnapshot = JSON.parse(JSON.stringify(room.taskset));
  }
}

/**
 * Main entry.
 *
 * deps.regenerateSingleTask — the async function to build a replacement
 *   task. Injected so tests can stub it without pulling in the LLM stack.
 * deps.onLog — optional (msg, meta) => void for verbose telemetry.
 */
export async function substituteTasksForRoom(room, deps = {}) {
  if (!room || !room.taskset) {
    return { substitutionCount: 0, log: [] };
  }
  const mode = room.deviceMode || "tablet_only";
  const log = [];

  // Fast path: tablet_only plays everything, so restore + no-op.
  if (mode === "tablet_only") {
    restoreOriginalIfSnapshotted(room);
    return { substitutionCount: 0, log };
  }

  // Snapshot on first substitution pass, restore for any subsequent pass.
  snapshotIfNeeded(room);
  restoreOriginalIfSnapshotted(room);
  // (restoreOriginalIfSnapshotted resets room._deviceSubstitutionLog to [])

  const tasks = Array.isArray(room.taskset.tasks) ? room.taskset.tasks : [];
  if (tasks.length === 0) {
    return { substitutionCount: 0, log };
  }

  // Attach a stable index to each task so we can splice in-place after the
  // partition returns them in a different shape.
  const withIndex = tasks.map((task, index) => ({ ...task, __idx: index }));
  const { incompatible } = filterTasksForDeviceMode(withIndex, mode, TASK_TYPE_META);

  if (incompatible.length === 0) {
    room._deviceSubstitutionLog = log;
    return { substitutionCount: 0, log };
  }

  const regenerate = deps.regenerateSingleTask;
  const ctx = buildRegenContext(room.taskset);
  const substitutedIndices = new Set();

  for (const rec of incompatible) {
    const origType = rec.task?.taskType || rec.task?.type;
    const origIdx = rec.task?.__idx;
    if (typeof origIdx !== "number") continue;

    const candidates = pickCandidatesFor(origType);
    let replacement = null;
    let usedType = null;
    let lastErr = null;

    if (regenerate) {
      for (const candidateType of candidates) {
        try {
          const generated = await regenerate({
            allowedType: candidateType,
            subject: ctx.subject,
            gradeLevel: ctx.gradeLevel,
            difficulty: ctx.difficulty,
            learningGoal: ctx.learningGoal,
            topicLabel: ctx.topicLabel,
            vocabularyLines: ctx.vocabularyLines,
            specialConsiderations: ctx.specialConsiderations,
            temperature: 0.8,
          });
          if (generated && (generated.taskType || generated.type)) {
            replacement = generated;
            usedType = candidateType;
            break;
          }
        } catch (err) {
          lastErr = err;
          if (deps.onLog) {
            deps.onLog(`[device-substitute] candidate ${candidateType} failed for ${origType}`, {
              err: err?.message,
            });
          }
        }
      }
    }

    if (replacement) {
      // Preserve the original task's identifying metadata that downstream
      // code may hang off (id, roundNumber, etc.), then overlay the
      // replacement's content.
      const original = rec.task;
      const merged = {
        ...replacement,
        // roundNumber/order preservation
        roundNumber: original.roundNumber,
        order: original.order,
        // mark as substituted so analytics can find these later
        _deviceModeSubstituted: {
          originalType: origType,
          substitutedType: usedType,
          reason: rec.reason,
        },
      };
      room.taskset.tasks[origIdx] = merged;
      substitutedIndices.add(origIdx);
      log.push({
        action: "substituted",
        index: origIdx,
        originalType: origType,
        substitutedType: usedType,
      });
    } else {
      // All candidates failed — drop the task from the sequence.
      log.push({
        action: "dropped",
        index: origIdx,
        originalType: origType,
        reason: lastErr?.message || "regeneration unavailable",
      });
    }
  }

  // If any were dropped (regen failed), compact the array.
  const dropIdxs = new Set(
    log.filter((entry) => entry.action === "dropped").map((entry) => entry.index)
  );
  if (dropIdxs.size > 0) {
    room.taskset.tasks = room.taskset.tasks.filter((_, i) => !dropIdxs.has(i));
  }

  room._deviceSubstitutionLog = log;
  return { substitutionCount: log.length, log };
}

/**
 * Convenience for the `teacher:setDeviceMode` handler — re-run substitution
 * when the mode changes. Safe to call even when no taskset is loaded.
 */
export async function reapplySubstitutionForRoom(room, deps = {}) {
  return substituteTasksForRoom(room, deps);
}
