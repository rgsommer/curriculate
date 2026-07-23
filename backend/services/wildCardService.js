// backend/services/wildCardService.js
//
// Tier 2 activation for 🃏 Wild Card. When a team taps their power,
// the server regenerates a same-topic, different-type replacement
// task for THIS team ONLY and stores it as a per-team override on
// the room. The submit path checks the override before falling back
// to the shared taskset.
//
// Constraints:
//   - Replacement type must be different from the original
//   - Only universal, teacher-safe types are in the pool (no motion,
//     no QR-scan, no competitive-game types that would land oddly
//     mid-taskset)
//   - Regeneration uses the SAME subject / grade / topic / vocab
//     that were used for the original taskset — same buildRegenContext
//     shape as backend/services/deviceModeSubstitute.js so the two
//     services can share a mental model
//   - If regen throws for every candidate, we return { ok: false }
//     and the caller acks the client without swapping — the team
//     still has their power available for retry.

import { TASK_TYPES } from "../../shared/taskTypes.js";

const SAFE_REPLACEMENT_POOL = [
  TASK_TYPES.MULTIPLE_CHOICE,
  TASK_TYPES.TRUE_FALSE,
  TASK_TYPES.SHORT_ANSWER,
  TASK_TYPES.CLOZE,
  TASK_TYPES.MATCHING,
  TASK_TYPES.BRAIN_BLITZ,
  TASK_TYPES.FLASHCARDS_RACE,
];

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
 * Roll a Wild Card replacement for the team's current task.
 *
 * @param {object} args
 * @param {object} args.room — the in-memory room
 * @param {object} args.team — the team object being wild-carded
 * @param {number} args.taskIndex — the index of the task to replace
 * @param {function} args.regenerateSingleTask — injected AI generator
 *
 * @returns {Promise<{ok, task?, replacedType?, error?}>}
 */
export async function rollWildCard({ room, team, taskIndex, regenerateSingleTask }) {
  if (!room?.taskset) return { ok: false, error: "no-taskset" };
  const originalTask = room.taskset.tasks?.[taskIndex];
  if (!originalTask) return { ok: false, error: "no-task-at-index" };

  const originalType = originalTask.taskType || originalTask.type;
  const ctx = buildRegenContext(room.taskset);

  // Pick candidates that AREN'T the current type. We shuffle so the
  // team doesn't always see the same type; if the first candidate's
  // generation fails we fall through to the next.
  const candidates = SAFE_REPLACEMENT_POOL
    .filter((t) => t !== originalType)
    .slice()
    .sort(() => Math.random() - 0.5);

  let lastErr = null;
  for (const candidateType of candidates) {
    try {
      const generated = await regenerateSingleTask({
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
        // Preserve the original's round/order so the client's task
        // header + progress bar don't lurch.
        const merged = {
          ...generated,
          roundNumber: originalTask.roundNumber,
          order: originalTask.order,
          _wildCardReplacement: {
            originalType,
            newType: generated.taskType || generated.type,
            replacedAt: new Date().toISOString(),
          },
        };
        // Stamp the override onto the team so the submit path picks it
        // up when scoring. Cleared after the team submits or advances.
        team.taskOverride = {
          taskIndex,
          task: merged,
          poweredBy: "wild_card",
        };
        return { ok: true, task: merged, replacedType: originalType };
      }
    } catch (err) {
      lastErr = err;
    }
  }

  return {
    ok: false,
    error: lastErr?.message || "no-replacement-generated",
  };
}

/**
 * Clear a stale Wild Card override when the team advances past
 * that task without submitting on it (e.g. teacher force-next).
 * Idempotent.
 */
export function clearWildCardOverrideIfMoved(team, currentTaskIndex) {
  if (!team?.taskOverride) return;
  if (team.taskOverride.taskIndex !== currentTaskIndex) {
    team.taskOverride = null;
  }
}

export const __constants = {
  SAFE_REPLACEMENT_POOL,
};
