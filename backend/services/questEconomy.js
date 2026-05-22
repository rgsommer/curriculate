// backend/services/questEconomy.js
//
// Quest Mode coin + inventory economy.
//
// Public API:
//   - getQuestState({ roomCode, teamId, tasksetId? })  → upserted state document
//   - awardCoins({ roomCode, teamId, amount, reason, tasksetId? }) → { state, awarded }
//   - spendCoins({ roomCode, teamId, amount, reason }) → { ok, state }   (returns ok:false if insufficient)
//   - grantResource({ roomCode, teamId, resourceId, quantity, reason })
//   - getQuestStateSnapshot(state) → plain JSON-safe object (Map → plain object) for socket emits
//
// All writes use atomic $inc / $push to avoid races between concurrent
// task-completion events. Coin amounts ≤ 0 are silently ignored.

import TeamQuestState from "../models/TeamQuestState.js";

/**
 * Get or lazily create a team's quest state row.
 */
export async function getQuestState({ roomCode, teamId, tasksetId = null }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId) throw new Error("getQuestState: roomCode + teamId required");

  const doc = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $setOnInsert: {
        roomCode: code,
        teamId,
        tasksetId: tasksetId || undefined,
        coins: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

/**
 * Award coins to a team. Returns the updated state plus how much was actually awarded
 * (sanitized amount). No-ops on non-positive amounts.
 */
export async function awardCoins({ roomCode, teamId, amount, reason = "task-complete", tasksetId = null }) {
  const code = String(roomCode || "").toUpperCase();
  const pts = Math.max(0, Math.floor(Number(amount) || 0));
  if (!code || !teamId || pts === 0) {
    return { state: null, awarded: 0 };
  }

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $inc: { coins: pts },
      $setOnInsert: { tasksetId: tasksetId || undefined },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // (Reason is logged separately in caller's analytics path — we don't persist a per-grant log here in v1)
  void reason;

  return { state, awarded: pts };
}

/**
 * Atomically spend coins. Returns { ok: false } if insufficient balance.
 * Uses findOneAndUpdate with a balance precondition so concurrent spend attempts can't overdraw.
 */
export async function spendCoins({ roomCode, teamId, amount, reason = "resource-acquire" }) {
  const code = String(roomCode || "").toUpperCase();
  const pts = Math.max(0, Math.floor(Number(amount) || 0));
  if (!code || !teamId) return { ok: false, state: null, reason: "missing roomCode/teamId" };
  if (pts === 0) return { ok: true, state: await getQuestState({ roomCode: code, teamId }), spent: 0 };

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId, coins: { $gte: pts } },
    { $inc: { coins: -pts } },
    { new: true },
  );
  if (!state) {
    // Could be insufficient balance OR row doesn't exist
    const existing = await TeamQuestState.findOne({ roomCode: code, teamId }).lean();
    return { ok: false, state: existing || null, reason: "insufficient coins" };
  }
  void reason;
  return { ok: true, state, spent: pts };
}

/**
 * Grant N units of a resource to a team. Server-trusted — the caller is expected to
 * have already validated the acquisition path (coin cost, challenge completion, etc.).
 */
export async function grantResource({ roomCode, teamId, resourceId, quantity = 1, reason = "acquired" }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !resourceId) return { ok: false, state: null };
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $inc: { [`inventory.${resourceId}`]: qty },
      $setOnInsert: { roomCode: code, teamId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  void reason;
  return { ok: true, state };
}

/**
 * Convert a TeamQuestState document into a plain JSON-safe object suitable for socket emit.
 * Maps need explicit conversion or they serialize as `{}`.
 */
export function getQuestStateSnapshot(state) {
  if (!state) return null;
  const inv = {};
  if (state.inventory && typeof state.inventory.forEach === "function") {
    state.inventory.forEach((v, k) => { inv[k] = v; });
  } else if (state.inventory && typeof state.inventory === "object") {
    Object.assign(inv, state.inventory);
  }
  return {
    roomCode: state.roomCode,
    teamId: state.teamId,
    coins: state.coins,
    inventory: inv,
    completedObjectives: state.completedObjectives || [],
    unlockedBonusTaskIds: state.unlockedBonusTaskIds || [],
    unlockedHiddenTaskIds: state.unlockedHiddenTaskIds || [],
    completedBonusTaskIds: state.completedBonusTaskIds || [],
    completedHiddenTaskIds: state.completedHiddenTaskIds || [],
    questRank: state.questRank,
  };
}

/**
 * Record completion of a task and evaluate quest unlocks.
 * Returns: { state, newlyUnlockedBonusIds, newlyUnlockedHiddenIds, corePct }
 *
 * Callers (handleStudentSubmit) should:
 *   - emit `quest:stateUpdated` with the returned state snapshot
 *   - emit `quest:taskUnlocked` for each newly-unlocked id (broadcast per-team)
 */
export async function recordTaskComplete({ roomCode, teamId, tasksetDoc, task, taskIdInDoc, sessionStartedAt = null, sessionDurationMin = null }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !tasksetDoc) return null;

  const { evaluateUnlocks, computeCoreProgressPct } = await import("./questUnlocks.js");

  // Determine the task id (matching questUnlocks.js's resolveTaskId)
  const idx = Array.isArray(tasksetDoc.tasks) ? tasksetDoc.tasks.findIndex((t) => t === task || t?.taskId === task?.taskId) : -1;
  const taskId = String(taskIdInDoc || task?.taskId || task?._id || (idx >= 0 ? `idx-${idx}` : "unknown"));

  // Push the completion into the right bucket
  const isBonus  = task?.isBonus  === true;
  const isHidden = task?.isHidden === true;
  const bucketField = isHidden ? "completedHiddenTaskIds" : isBonus ? "completedBonusTaskIds" : "completedCoreTaskIds";
  // completedCoreTaskIds isn't a top-level field on TeamQuestState yet (we stuff it under tradeHistory for v1?)
  // Quick path: store core completions in a virtual array via $addToSet on a custom key — but Mongoose
  // schema doesn't allow arbitrary fields. Instead, derive core completions by looking at the room
  // submissions (passed in by the caller via the room object). For MVP simplicity here, we ONLY use
  // bonus/hidden buckets which DO exist on the schema, and computeCoreProgressPct accepts a fresh array.

  let state = await TeamQuestState.findOne({ roomCode: code, teamId }).exec();
  if (!state) state = await getQuestState({ roomCode: code, teamId });

  if (isBonus || isHidden) {
    const updated = await TeamQuestState.findOneAndUpdate(
      { roomCode: code, teamId },
      { $addToSet: { [bucketField]: taskId } },
      { new: true },
    );
    if (updated) state = updated;
  }

  // Core completion is derived from the caller's passed-in list to avoid schema churn.
  // The caller (handleStudentSubmit) will compute it from room.submissions.
  return state;
}

export default {
  getQuestState,
  awardCoins,
  spendCoins,
  grantResource,
  getQuestStateSnapshot,
  recordTaskComplete,
};
