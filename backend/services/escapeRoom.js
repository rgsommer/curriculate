// backend/services/escapeRoom.js
//
// Escape Room engine — pure server-trusted lock / key / fragment evaluation.
// Operates against a TaskSet's escapeRoomConfig (see ESCAPE_ROOM_PLAN.md §4a)
// and per-team EscapeRoomTeamState.
//
// Public API:
//   - getTeamState({ roomCode, teamId, tasksetId? })
//   - getStateSnapshot(state)                            JSON-safe shape for socket emit
//   - onTaskCompleted({ roomCode, teamId, taskset, taskId })   grants keys + fragments tied to the task
//   - attemptUnlock({ roomCode, teamId, taskset, lockId, submission })  validates a synthesis answer
//   - useHint({ roomCode, teamId, lockId })              increments hint counter (rate-limit policy in caller)

import EscapeRoomTeamState from "../models/EscapeRoomTeamState.js";

export async function getTeamState({ roomCode, teamId, tasksetId = null }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId) throw new Error("escapeRoom.getTeamState requires roomCode + teamId");
  return EscapeRoomTeamState.findOneAndUpdate(
    { roomCode: code, teamId },
    { $setOnInsert: { roomCode: code, teamId, tasksetId: tasksetId || undefined } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export function getStateSnapshot(state) {
  if (!state) return null;
  return {
    roomCode: state.roomCode,
    teamId:   state.teamId,
    keysEarned:       state.keysEarned || [],
    fragmentsEarned:  state.fragmentsEarned || [],
    locksOpened:      state.locksOpened || [],
    hintsUsed:        state.hintsUsed || 0,
    narrativeBeatsDelivered: state.narrativeBeatsDelivered || [],
    finalPuzzleState: state.finalPuzzleState || null,
    startedAt:        state.startedAt,
    completedAt:      state.completedAt,
    escapeTimeMs:     state.escapeTimeMs,
  };
}

function _keysGrantedByTask(taskset, taskId) {
  const keys = Array.isArray(taskset?.escapeRoomConfig?.keys) ? taskset.escapeRoomConfig.keys : [];
  return keys.filter((k) => k?.grantedBy?.taskId && String(k.grantedBy.taskId) === String(taskId)).map((k) => k.id);
}

function _fragmentsGrantedByTask(taskset, taskId) {
  // Fragments may be unlocked by a `unlocks.fragments` array on a LOCK whose `requires.keys` is now satisfied.
  // For MVP, we ALSO support direct fragment grant via a fragment's `grantedBy.taskId` (extending the spec slightly).
  const fragments = Array.isArray(taskset?.escapeRoomConfig?.fragments) ? taskset.escapeRoomConfig.fragments : [];
  return fragments
    .filter((f) => f?.grantedBy?.taskId && String(f.grantedBy.taskId) === String(taskId))
    .map((f) => f.id);
}

function _locksToEvaluate(taskset, state) {
  const locks = Array.isArray(taskset?.escapeRoomConfig?.locks) ? taskset.escapeRoomConfig.locks : [];
  const opened = new Set(state?.locksOpened || []);
  return locks.filter((l) => l && l.id && !opened.has(l.id));
}

function _meetsRequires(req, state) {
  if (!req || typeof req !== "object") return true;
  const keysHave = new Set(state?.keysEarned || []);
  const fragHave = new Set(state?.fragmentsEarned || []);
  if (Array.isArray(req.keys) && req.keys.length > 0) {
    if (typeof req.minCount === "number" && req.minCount > 0) {
      const got = req.keys.filter((k) => keysHave.has(k)).length;
      if (got < req.minCount) return false;
    } else {
      for (const k of req.keys) if (!keysHave.has(k)) return false;
    }
  }
  if (Array.isArray(req.fragments) && req.fragments.length > 0) {
    for (const f of req.fragments) if (!fragHave.has(f)) return false;
  }
  return true;
}

/**
 * Called from handleStudentSubmit after a successful task completion.
 * Grants any keys / fragments tied to the task, then auto-opens any locks
 * whose requirements were just satisfied (cascading lock evaluation).
 */
export async function onTaskCompleted({ roomCode, teamId, taskset, taskId }) {
  if (!taskset?.escapeRoomConfig) return null;
  const code = String(roomCode || "").toUpperCase();
  const newKeys      = _keysGrantedByTask(taskset, taskId);
  const newFragments = _fragmentsGrantedByTask(taskset, taskId);
  if (newKeys.length === 0 && newFragments.length === 0) {
    return getTeamState({ roomCode: code, teamId, tasksetId: taskset?._id || null });
  }

  let state = await EscapeRoomTeamState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $addToSet: {
        keysEarned:      { $each: newKeys },
        fragmentsEarned: { $each: newFragments },
      },
      $setOnInsert: { roomCode: code, teamId, tasksetId: taskset?._id || undefined },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Cascading lock evaluation — open any locks whose requires are now met, then
  // recursively re-evaluate because an opened lock may grant more keys/fragments.
  let openedSomething = true;
  while (openedSomething) {
    openedSomething = false;
    const candidates = _locksToEvaluate(taskset, state);
    for (const lock of candidates) {
      if (!_meetsRequires(lock.requires, state)) continue;
      const grantKeys      = Array.isArray(lock.unlocks?.keys)      ? lock.unlocks.keys      : [];
      const grantFragments = Array.isArray(lock.unlocks?.fragments) ? lock.unlocks.fragments : [];
      state = await EscapeRoomTeamState.findOneAndUpdate(
        { roomCode: code, teamId },
        {
          $addToSet: {
            locksOpened: lock.id,
            keysEarned:      { $each: grantKeys },
            fragmentsEarned: { $each: grantFragments },
          },
          ...(lock.unlocks?.roomCompleted ? { $set: { completedAt: new Date(), escapeTimeMs: state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : null } } : {}),
        },
        { new: true },
      );
      openedSomething = true;
    }
  }

  return state;
}

/**
 * Validate a synthesis-puzzle answer for a final lock. Returns { ok, lockId, opened? }.
 * The lock's `type` determines how validation works:
 *   - "password" / "scan" / "cipher-digit" / "key-list":
 *       expects a `synthesisAnswer` field on the lock (string or array of strings).
 *       Matches case-insensitive after trimming punctuation.
 *   - "synthesis":
 *       must have requires.fragments and the submission's value field must equal a
 *       deterministic combination of the fragments' revealValue (concatenation in
 *       `position` order).
 *   - "evidence-chain" / future types: deferred.
 */
export async function attemptUnlock({ roomCode, teamId, taskset, lockId, submission }) {
  if (!taskset?.escapeRoomConfig) return { ok: false, error: "Not an escape-room taskset" };
  const lock = (taskset.escapeRoomConfig.locks || []).find((l) => l?.id === lockId);
  if (!lock) return { ok: false, error: "Unknown lock" };

  const code = String(roomCode || "").toUpperCase();
  const state = await getTeamState({ roomCode: code, teamId, tasksetId: taskset?._id });
  if (!_meetsRequires(lock.requires, state)) {
    return { ok: false, error: "Requirements not met" };
  }

  const text = String(submission || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  let isCorrect = false;
  if (lock.type === "synthesis" && Array.isArray(lock.requires?.fragments)) {
    const fragments = taskset.escapeRoomConfig.fragments || [];
    const ordered = lock.requires.fragments
      .map((fid) => fragments.find((f) => f?.id === fid))
      .filter(Boolean)
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .map((f) => String(f.revealValue || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
      .join("");
    isCorrect = text === ordered && ordered.length > 0;
  } else if (lock.synthesisAnswer) {
    const accepted = Array.isArray(lock.synthesisAnswer) ? lock.synthesisAnswer : [lock.synthesisAnswer];
    isCorrect = accepted.some((a) => {
      const norm = String(a).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      return norm && norm === text;
    });
  }

  if (!isCorrect) return { ok: false, error: "Wrong answer" };

  // Open the lock + cascade
  const updated = await EscapeRoomTeamState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $addToSet: {
        locksOpened: lock.id,
        keysEarned:      { $each: Array.isArray(lock.unlocks?.keys)      ? lock.unlocks.keys      : [] },
        fragmentsEarned: { $each: Array.isArray(lock.unlocks?.fragments) ? lock.unlocks.fragments : [] },
      },
      ...(lock.unlocks?.roomCompleted ? { $set: { completedAt: new Date(), escapeTimeMs: state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : null } } : {}),
    },
    { new: true },
  );
  return { ok: true, lockId, state: getStateSnapshot(updated) };
}

export async function useHint({ roomCode, teamId, lockId }) {
  const code = String(roomCode || "").toUpperCase();
  const state = await EscapeRoomTeamState.findOneAndUpdate(
    { roomCode: code, teamId },
    { $inc: { hintsUsed: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { ok: true, hintsUsed: state.hintsUsed, lockId };
}

export default { getTeamState, getStateSnapshot, onTaskCompleted, attemptUnlock, useHint };
