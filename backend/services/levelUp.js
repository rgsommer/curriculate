// backend/services/levelUp.js
//
// LevelUp — early-finisher score upgrade engine.
//
// After a team completes all required (`requiredForCompletion: true`) tasks AND
// both always-on bonus tasks (`isBonus: true, requiredForCompletion: false`),
// they may re-attempt their lowest-scored task with an AI-regenerated variant
// of the same task type. The team keeps MAX(originalScore, retryScore) and
// receives a +5 mastery bonus if the retry strictly improves on the original.
//
// See LEVEL_UP_PLAN.md for the full spec.

import { regenerateSingleTask } from "../controllers/sharedTasksetController.js";
import { TASK_TYPE_META } from "../../shared/taskTypes.js";

// ── Configuration ────────────────────────────────────────────────────────────
export const MAX_LEVEL_UP_ATTEMPTS = 2;
export const LEVEL_UP_COOLDOWN_MS = 30 * 1000;
export const MASTERY_BONUS_POINTS = 5;

// Task types eligible to be LevelUp candidates. Must have:
//  • objective or semi-objective scoring (so we can compute "lowest")
//  • a clean AI generator branch (so we can regenerate a fresh variant)
//  • no expensive one-shot creative output (open-text, photo, draw, etc.)
export const LEVEL_UP_ELIGIBLE_TYPES = new Set([
  // Objective question packs
  "multiple-choice",
  "true-false",
  "short-answer",
  "cloze",
  // Sort / sequence / match
  "matching",
  "sort",
  "sequence",
  "mad-dash-sequence",
  "timeline",
  "vennsort",
  // Quick recall
  "spinner",
  "trivia",
  "riddle",
  "brain-blitz",
  "fake-out",
  // Flashcards
  "flashcards",
  "flashcards-race",
  // Word games
  "hangman-duel",
  "mystery-clues",
  // Note / map
  "mind-mapper",
  "brain-spark-notes",
  // Physical scaffolds
  "pet-feeding",
  "mad-dash",
  "tower-builder",
  "hole-in-one",
  // Newer types with objective AI scoring
  "musical-chairs",
  "peer-editing",
  "legends",
  "what-am-i",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute per-task score% for every objective-ish task that this team attempted. */
function buildPerTaskScores(room, teamId) {
  const teamSubs = (room.submissions || []).filter(
    (s) => String(s.teamId) === String(teamId) && !s.skipped,
  );
  const tasks = room.taskset?.tasks || [];
  const results = [];

  // Aggregate by taskIndex; if a task has been LevelUp'd we keep the MAX score
  // (so we don't try to LevelUp it again on its now-improved score).
  const byIndex = new Map();
  for (const sub of teamSubs) {
    const idx = sub.taskIndex;
    if (!Number.isFinite(idx) || idx < 0) continue;
    const task = tasks[idx];
    if (!task) continue;
    const points = Number(sub.points) || 0;
    const basePoints = (task.points ?? 100) * 10;
    const scorePercent = basePoints > 0 ? (points / basePoints) * 100 : 0;
    const prev = byIndex.get(idx);
    if (!prev || scorePercent > prev.scorePercent) {
      byIndex.set(idx, {
        taskIndex: idx,
        task,
        taskType: task.taskType,
        points,
        basePoints,
        scorePercent,
        isLevelUp: !!task.isLevelUp,
        levelUpOfTaskIndex: task.levelUpOfTaskIndex ?? null,
      });
    }
  }

  for (const r of byIndex.values()) results.push(r);
  return results;
}

/** Has the team completed core + both bonus tasks? */
export function teamReadyForLevelUp(room, teamId) {
  const tasks = room.taskset?.tasks || [];
  if (!tasks.length) return false;

  const requiredIdxs = [];
  const bonusIdxs = [];
  tasks.forEach((t, idx) => {
    if (t.isLevelUp) return; // ignore prior LevelUp injections
    if (t.requiredForCompletion === false && t.isBonus) bonusIdxs.push(idx);
    else if (t.requiredForCompletion !== false) requiredIdxs.push(idx);
  });

  const teamSubs = (room.submissions || []).filter(
    (s) => String(s.teamId) === String(teamId),
  );
  const completedIdxs = new Set(teamSubs.map((s) => s.taskIndex));

  const coreDone = requiredIdxs.every((i) => completedIdxs.has(i));
  // If the taskset doesn't have any tagged bonus tasks (legacy), bonus is
  // considered "satisfied" so LevelUp can still be offered.
  const bonusDone =
    bonusIdxs.length === 0 || bonusIdxs.every((i) => completedIdxs.has(i));
  return coreDone && bonusDone;
}

/** Picks the lowest-score eligible task. Returns null if none qualifies. */
export function pickLevelUpCandidate(room, teamId) {
  const scores = buildPerTaskScores(room, teamId);
  if (!scores.length) return null;

  // Track which task types have already been LevelUp'd this session for this
  // team (one-per-type cap).
  const typesAlreadyUpgraded = new Set();
  for (const r of scores) {
    if (r.isLevelUp) typesAlreadyUpgraded.add(r.taskType);
  }

  // Filter to attempted (non-zero or has explicit submission), eligible-type,
  // not-already-upgraded, not itself a LevelUp task.
  const eligible = scores.filter((r) => {
    if (r.isLevelUp) return false;
    if (!LEVEL_UP_ELIGIBLE_TYPES.has(r.taskType)) return false;
    if (typesAlreadyUpgraded.has(r.taskType)) return false;
    return true;
  });
  if (!eligible.length) return null;

  // Sort ascending by scorePercent, then descending by taskIndex (recency).
  eligible.sort((a, b) => {
    if (a.scorePercent !== b.scorePercent) return a.scorePercent - b.scorePercent;
    return b.taskIndex - a.taskIndex;
  });
  return eligible[0];
}

/** Per-team LevelUp state, lazily initialized on the in-memory room object. */
export function getTeamLevelUpState(room, teamId) {
  if (!room.levelUpState) room.levelUpState = {};
  if (!room.levelUpState[teamId]) {
    room.levelUpState[teamId] = {
      attempts: 0,
      lastAttemptAt: 0,
      history: [], // [{ originalTaskIndex, newTaskIndex, originalScore, retryScore, kept, improved, masteryBonus }]
    };
  }
  return room.levelUpState[teamId];
}

/** Returns reason string if LevelUp cannot be offered. */
export function whyLevelUpUnavailable(room, teamId) {
  if (!room || !room.taskset) return "no-room";
  const ts = room.taskset;
  if (ts.levelUpEnabledByDefault === false || room.levelUpDisabled === true) {
    return "disabled-by-teacher";
  }
  if (!teamReadyForLevelUp(room, teamId)) return "core-not-done";
  const st = getTeamLevelUpState(room, teamId);
  if (st.attempts >= MAX_LEVEL_UP_ATTEMPTS) return "max-attempts";
  const since = Date.now() - (st.lastAttemptAt || 0);
  if (since < LEVEL_UP_COOLDOWN_MS) return "cooldown";
  const candidate = pickLevelUpCandidate(room, teamId);
  if (!candidate) return "no-eligible-task";
  return null;
}

/** Public: build the "offer" payload for the student client. */
export function buildLevelUpOffer(room, teamId) {
  const reason = whyLevelUpUnavailable(room, teamId);
  if (reason) return { available: false, reason };
  const candidate = pickLevelUpCandidate(room, teamId);
  const st = getTeamLevelUpState(room, teamId);
  return {
    available: true,
    candidate: {
      taskIndex: candidate.taskIndex,
      taskType: candidate.taskType,
      taskTitle: candidate.task.title || candidate.task.taskType || "Task",
      scorePercent: Math.round(candidate.scorePercent),
      points: candidate.points,
      basePoints: candidate.basePoints,
    },
    attemptsUsed: st.attempts,
    attemptsRemaining: MAX_LEVEL_UP_ATTEMPTS - st.attempts,
  };
}

/**
 * Generates a fresh variant of the lowest-scored task. Returns the new task
 * object (already validated + sanitized), ready to be pushed onto
 * room.taskset.tasks. Throws on generation failure (caller should not deduct
 * an attempt in that case).
 */
export async function generateLevelUpVariant(room, candidate) {
  const meta = TASK_TYPE_META?.[candidate.taskType] || {};
  const taskset = room.taskset || {};
  const original = candidate.task || {};

  const variant = await regenerateSingleTask({
    allowedType: candidate.taskType,
    onPrompt: null,
    mustHave: meta.mustHave || null,
    subject: taskset.subject || "general",
    gradeLevel: taskset.gradeLevel || taskset.grade || "5",
    difficulty: taskset.difficulty || "medium",
    learningGoal: original.learningGoal || taskset.learningGoal || "",
    topicLabel: original.title || taskset.name || taskset.title || "",
    vocabularyLines: Array.isArray(taskset.vocabulary)
      ? taskset.vocabulary.join("\n")
      : "",
    specialConsiderations:
      `LEVEL-UP RETRY: Generate a FRESH ${candidate.taskType} task on the same learning objective ` +
      `("${original.title || ""}"). DIFFERENT items, options, and prompts than the original. ` +
      `Same difficulty, same skill, different content. Do not reuse the original text.`,
    previousTask: original,
    previousError: null,
    temperature: 0.9,
  });

  if (!variant || !variant.taskType) {
    throw new Error("regenerator returned an invalid task");
  }

  // Mark it as a LevelUp injection so:
  //   • the submit handler knows to apply max-of scoring
  //   • the report annotates it
  //   • it can't itself be LevelUp'd
  variant.isLevelUp = true;
  variant.levelUpOfTaskIndex = candidate.taskIndex;
  variant.levelUpOriginalScore = candidate.points;
  variant.levelUpOriginalBasePoints = candidate.basePoints;
  variant.requiredForCompletion = false;
  variant.isBonus = false;
  return variant;
}

/**
 * Apply the MAX scoring policy after a LevelUp task is submitted.
 * Returns { keptPoints, masteryBonus, improved, delta }.
 */
export function resolveLevelUpScore({ originalPoints, retryPoints }) {
  const orig = Number(originalPoints) || 0;
  const retry = Number(retryPoints) || 0;
  const improved = retry > orig;
  const kept = Math.max(orig, retry);
  const masteryBonus = improved ? MASTERY_BONUS_POINTS * 10 : 0; // 10× multiplier mirrors basePoints scaling
  return { keptPoints: kept, masteryBonus, improved, delta: retry - orig };
}
