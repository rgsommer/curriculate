// backend/services/questUnlocks.js
//
// Quest Mode bonus / hidden task unlock engine.
//
// Inputs:
//   - taskset: the full TaskSet doc (must have .tasks[] with isBonus / isHidden / unlockConditions)
//   - state:   TeamQuestState document (or snapshot — we read .completedObjectives etc.)
//   - signals: { coreProgressPct, sessionTimeRemainingMin }
//
// Output:
//   { newlyUnlockedBonusIds: [...], newlyUnlockedHiddenIds: [...] }
//
// The unlock engine is purely functional — callers persist the result back into
// state.unlockedBonusTaskIds / state.unlockedHiddenTaskIds.

function _coreTasks(taskset) {
  if (!taskset || !Array.isArray(taskset.tasks)) return [];
  return taskset.tasks.filter((t) => t && !t.isBonus && !t.isHidden);
}

function _bonusTasks(taskset) {
  if (!taskset || !Array.isArray(taskset.tasks)) return [];
  return taskset.tasks.filter((t) => t && t.isBonus === true);
}

function _hiddenTasks(taskset) {
  if (!taskset || !Array.isArray(taskset.tasks)) return [];
  return taskset.tasks.filter((t) => t && t.isHidden === true);
}

function _resolveTaskId(t, idxInTaskset) {
  return String(t?.taskId || t?._id || `idx-${idxInTaskset}`);
}

/**
 * Evaluate which bonus/hidden tasks should NOW be unlocked given the team's state + session signals.
 * Returns the IDs that aren't yet in state.unlockedBonusTaskIds / unlockedHiddenTaskIds.
 */
export function evaluateUnlocks({ taskset, state, signals = {} }) {
  const out = { newlyUnlockedBonusIds: [], newlyUnlockedHiddenIds: [] };
  if (!taskset || !state) return out;

  const corePct = Number(signals.coreProgressPct);     // 0..100
  const timeLeft = Number(signals.sessionTimeRemainingMin);  // minutes
  const coreDone = signals.coreQuestCompleted === true || corePct >= 100;

  const alreadyBonus = new Set(state.unlockedBonusTaskIds || []);
  const alreadyHidden = new Set(state.unlockedHiddenTaskIds || []);

  // Map task index → id, then filter to bonus/hidden
  for (let idx = 0; idx < (taskset.tasks?.length || 0); idx++) {
    const t = taskset.tasks[idx];
    if (!t) continue;
    const id = _resolveTaskId(t, idx);

    if (t.isBonus === true && !alreadyBonus.has(id)) {
      const cond = (t.unlockConditions && typeof t.unlockConditions === "object") ? t.unlockConditions : { coreProgressPct: 80 };
      const need = Number(cond.coreProgressPct);
      if (Number.isFinite(need) ? corePct >= need : true) {
        out.newlyUnlockedBonusIds.push(id);
      }
    }

    if (t.isHidden === true && !alreadyHidden.has(id)) {
      const cond = (t.unlockConditions && typeof t.unlockConditions === "object") ? t.unlockConditions : {};
      let ok = true;
      if (cond.coreQuestCompleted === true && !coreDone) ok = false;
      if (Number.isFinite(Number(cond.minRemainingMinutes)) && Number(cond.minRemainingMinutes) > 0) {
        if (!Number.isFinite(timeLeft) || timeLeft < Number(cond.minRemainingMinutes)) ok = false;
      }
      if (Number.isFinite(Number(cond.minCoins)) && Number(cond.minCoins) > 0) {
        if ((Number(state.coins) || 0) < Number(cond.minCoins)) ok = false;
      }
      if (ok) out.newlyUnlockedHiddenIds.push(id);
    }
  }
  return out;
}

/**
 * Compute the core-progress percentage (0..100) given the taskset and the team's
 * completedCoreTaskIds set (passed in by the caller — the engine doesn't crawl submissions).
 */
export function computeCoreProgressPct({ taskset, completedCoreTaskIds = [] }) {
  const core = _coreTasks(taskset);
  if (core.length === 0) return 0;
  const completed = new Set(completedCoreTaskIds.map(String));
  let count = 0;
  for (let i = 0; i < core.length; i++) {
    const id = _resolveTaskId(core[i], i);
    if (completed.has(id)) count += 1;
  }
  return Math.round((count / core.length) * 100);
}

export { _coreTasks as coreTasks, _bonusTasks as bonusTasks, _hiddenTasks as hiddenTasks };
export default { evaluateUnlocks, computeCoreProgressPct };
