// ====================================================================
//  Mystery Box Engine
//  Handles mystery-box navigation mode: shuffled task grids, box opening,
//  inter-team challenge beacons, and bonus multipliers.
// ====================================================================

import { TASK_TYPE_META } from "../../shared/taskTypes.js";

// ================================
// SHUFFLE UTILITY (Fisher-Yates)
// ================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ================================
// CONSTANTS
// ================================
const CHALLENGE_TIMEOUT_MS = 45_000; // 45 seconds for teams to accept inter-team challenge
const CHALLENGE_BONUS_MULTIPLIER = 1.5;
const MIN_BONUS = 0.9;
const MAX_BONUS = 1.3;

// ================================
// INITIALISE MYSTERY BOX STATE
// ================================

/**
 * Called when teacher launches a taskset in mystery-box mode.
 * Sets up per-team shuffled box orders and bonus multipliers.
 *
 * @param {Object} room - The room object from rooms[]
 * @param {Array} tasks - Array of task objects from the taskset
 * @returns {Object} The mystery box state stored on room.mysteryBox
 */
export function initMysteryBox(room, tasks) {
  const teamIds = Object.keys(room.teams || {});
  const taskCount = tasks.length;

  // Generate a random bonus multiplier per box per team
  function randomBonus() {
    return Math.round((MIN_BONUS + Math.random() * (MAX_BONUS - MIN_BONUS)) * 100) / 100;
  }

  // Determine which tasks are inter-team
  const interTeamIndices = new Set();
  tasks.forEach((t, i) => {
    const meta = TASK_TYPE_META[t.taskType];
    if (meta && meta.interTeamEnabled) {
      interTeamIndices.add(i);
    }
  });

  const teamBoxes = {};
  for (const teamId of teamIds) {
    const order = shuffle([...Array(taskCount).keys()]);
    const bonuses = order.map(() => randomBonus());
    teamBoxes[teamId] = {
      order,          // shuffled indices into tasks[]
      bonuses,        // bonus multiplier per box position
      opened: [],     // box positions that have been opened (indices into order[])
      completed: [],  // box positions that have been completed
      activeBox: null, // box position currently being worked on (index into order[])
      points: {},     // { [boxPos]: pointsEarned }
      challengeQueued: null, // { challengeId, taskIndex, boxPos } if accepted a challenge
    };
  }

  room.mysteryBox = {
    enabled: true,
    taskCount,
    interTeamIndices: [...interTeamIndices],
    teamBoxes,
    challenges: {},   // { [challengeId]: { fromTeamId, taskIndex, acceptedByTeamId, status, createdAt, timeoutHandle } }
    globalTimerEnd: null, // set when session starts (Date.now() + durationMs)
    globalTimerMs: null,  // total duration in ms
  };

  return room.mysteryBox;
}

/**
 * Start the global mystery box timer.
 */
export function startMysteryTimer(room, durationMinutes) {
  if (!room.mysteryBox) return;
  const ms = (durationMinutes || 30) * 60 * 1000;
  room.mysteryBox.globalTimerMs = ms;
  room.mysteryBox.globalTimerEnd = Date.now() + ms;
}

// ================================
// BOX STATE FOR CLIENT
// ================================

/**
 * Build the box grid state for a specific team (sent to student device).
 * Does NOT include task content — just metadata per box.
 */
export function buildTeamBoxGrid(room, teamId) {
  const mb = room.mysteryBox;
  if (!mb) return null;

  const tb = mb.teamBoxes[teamId];
  if (!tb) return null;

  const tasks = room.taskset?.tasks || [];

  const boxes = tb.order.map((taskIndex, boxPos) => {
    const task = tasks[taskIndex];
    const meta = task ? TASK_TYPE_META[task.taskType] : null;
    const isOpened = tb.opened.includes(boxPos);
    const isCompleted = tb.completed.includes(boxPos);
    const isActive = tb.activeBox === boxPos;
    const isInterTeam = mb.interTeamIndices.includes(taskIndex);
    const basePoints = (task?.points ?? 100) * 10;
    const bonus = tb.bonuses[boxPos];
    const pointValue = Math.round(basePoints * bonus);

    return {
      boxPos,
      // Only reveal task details if opened
      taskType: isOpened ? task?.taskType : null,
      taskTitle: isOpened ? task?.title : null,
      isInterTeam: isInterTeam, // hint shown on closed box
      // Point value shown as star tier (1-3) when closed, exact when opened
      starTier: pointValue <= 700 ? 1 : pointValue <= 1200 ? 2 : 3,
      pointValue: isOpened ? pointValue : null,
      bonusMultiplier: isCompleted ? bonus : null,
      // State
      opened: isOpened,
      completed: isCompleted,
      active: isActive,
      pointsEarned: isCompleted ? (tb.points[boxPos] || 0) : null,
      // Category hint (shown on closed box)
      category: meta?.category || null,
    };
  });

  return {
    boxes,
    activeBox: tb.activeBox,
    completedCount: tb.completed.length,
    totalBoxes: mb.taskCount,
    challengeQueued: tb.challengeQueued,
    globalTimerEnd: mb.globalTimerEnd,
    globalTimerMs: mb.globalTimerMs,
  };
}

// ================================
// BOX OPERATIONS
// ================================

/**
 * Team opens a box. Returns the task to send, or null if invalid.
 */
export function openBox(room, teamId, boxPos) {
  const mb = room.mysteryBox;
  if (!mb) return { error: "Mystery box not enabled" };

  const tb = mb.teamBoxes[teamId];
  if (!tb) return { error: "Team not found in mystery box state" };

  if (typeof boxPos !== "number" || boxPos < 0 || boxPos >= tb.order.length) {
    return { error: "Invalid box position" };
  }

  // Can't open if already working on another box
  if (tb.activeBox !== null && tb.activeBox !== boxPos) {
    return { error: "Already working on another box" };
  }

  // Can't re-open a completed box
  if (tb.completed.includes(boxPos)) {
    return { error: "Box already completed" };
  }

  const taskIndex = tb.order[boxPos];
  const tasks = room.taskset?.tasks || [];
  const task = tasks[taskIndex];
  if (!task) return { error: "Task not found" };

  // Mark as opened and active
  if (!tb.opened.includes(boxPos)) {
    tb.opened.push(boxPos);
  }
  tb.activeBox = boxPos;

  return {
    task,
    taskIndex,
    boxPos,
    bonusMultiplier: tb.bonuses[boxPos],
    pointValue: Math.round(((task.points ?? 100) * 10) * tb.bonuses[boxPos]),
  };
}

/**
 * Record box completion after submission.
 */
export function completeBox(room, teamId, boxPos, pointsEarned) {
  const mb = room.mysteryBox;
  if (!mb) return;

  const tb = mb.teamBoxes[teamId];
  if (!tb) return;

  if (!tb.completed.includes(boxPos)) {
    tb.completed.push(boxPos);
  }
  tb.points[boxPos] = pointsEarned;

  // If this was the active box, clear it so they can pick another
  if (tb.activeBox === boxPos) {
    tb.activeBox = null;
  }

  // If a challenge was queued, activate it next
  if (tb.challengeQueued) {
    // Will be handled by the challenge system
  }
}

/**
 * Get the average completion % across all teams (for progress bar).
 */
export function getMysteryProgress(room) {
  const mb = room.mysteryBox;
  if (!mb || !mb.taskCount) return 0;

  const teamIds = Object.keys(mb.teamBoxes);
  if (teamIds.length === 0) return 0;

  const sum = teamIds.reduce((acc, tid) => {
    return acc + (mb.teamBoxes[tid].completed.length / mb.taskCount);
  }, 0);

  return Math.round((sum / teamIds.length) * 100);
}

// ================================
// INTER-TEAM CHALLENGE SYSTEM
// ================================

let challengeIdCounter = 0;

/**
 * Initiate an inter-team challenge when a team opens an inter-team box.
 * Returns challenge info. The caller (backend/index.js) should broadcast
 * the beacon to other teams.
 */
export function createChallenge(room, fromTeamId, taskIndex, boxPos) {
  const mb = room.mysteryBox;
  if (!mb) return null;

  const challengeId = `ch_${Date.now()}_${++challengeIdCounter}`;

  mb.challenges[challengeId] = {
    challengeId,
    fromTeamId,
    taskIndex,
    boxPos, // box position in the challenger's grid
    acceptedByTeamId: null,
    status: "pending", // pending | matched | expired | solo
    createdAt: Date.now(),
    timeoutHandle: null,
  };

  return mb.challenges[challengeId];
}

/**
 * A team accepts a challenge. Returns match info or null if no longer available.
 */
export function acceptChallenge(room, challengeId, acceptingTeamId) {
  const mb = room.mysteryBox;
  if (!mb) return null;

  const ch = mb.challenges[challengeId];
  if (!ch || ch.status !== "pending") return null;
  if (ch.fromTeamId === acceptingTeamId) return null; // can't accept your own

  ch.acceptedByTeamId = acceptingTeamId;
  ch.status = "matched";

  // Clear timeout
  if (ch.timeoutHandle) {
    clearTimeout(ch.timeoutHandle);
    ch.timeoutHandle = null;
  }

  // Find or create the box position for the accepting team
  const tb = mb.teamBoxes[acceptingTeamId];
  if (!tb) return null;

  // Find which box in the acceptor's grid maps to this taskIndex
  let acceptorBoxPos = tb.order.indexOf(ch.taskIndex);

  // Queue this as the acceptor's next task
  tb.challengeQueued = {
    challengeId,
    taskIndex: ch.taskIndex,
    boxPos: acceptorBoxPos >= 0 ? acceptorBoxPos : null,
    bonusMultiplier: CHALLENGE_BONUS_MULTIPLIER,
  };

  return {
    challengeId,
    fromTeamId: ch.fromTeamId,
    acceptingTeamId,
    taskIndex: ch.taskIndex,
    acceptorBoxPos,
  };
}

/**
 * Expire a challenge (no one accepted). Challenger proceeds solo.
 */
export function expireChallenge(room, challengeId) {
  const mb = room.mysteryBox;
  if (!mb) return;

  const ch = mb.challenges[challengeId];
  if (!ch || ch.status !== "pending") return;

  ch.status = "expired";
  if (ch.timeoutHandle) {
    clearTimeout(ch.timeoutHandle);
    ch.timeoutHandle = null;
  }
}

/**
 * Check if a team has a queued challenge to start next.
 * Returns the challenge info and clears the queue, or null.
 */
export function popQueuedChallenge(room, teamId) {
  const mb = room.mysteryBox;
  if (!mb) return null;

  const tb = mb.teamBoxes[teamId];
  if (!tb || !tb.challengeQueued) return null;

  const queued = tb.challengeQueued;
  tb.challengeQueued = null;
  return queued;
}

/**
 * Add a team that joined after mystery box was initialized.
 */
export function addTeamToMysteryBox(room, teamId) {
  const mb = room.mysteryBox;
  if (!mb) return;
  if (mb.teamBoxes[teamId]) return; // already exists

  const taskCount = mb.taskCount;
  const order = shuffle([...Array(taskCount).keys()]);
  const bonuses = order.map(() =>
    Math.round((MIN_BONUS + Math.random() * (MAX_BONUS - MIN_BONUS)) * 100) / 100
  );

  mb.teamBoxes[teamId] = {
    order,
    bonuses,
    opened: [],
    completed: [],
    activeBox: null,
    points: {},
    challengeQueued: null,
  };
}

export default {
  initMysteryBox,
  startMysteryTimer,
  buildTeamBoxGrid,
  openBox,
  completeBox,
  getMysteryProgress,
  createChallenge,
  acceptChallenge,
  expireChallenge,
  popQueuedChallenge,
  addTeamToMysteryBox,
};
