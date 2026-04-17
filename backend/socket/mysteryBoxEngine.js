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
const CHALLENGE_BONUS_MAX = 2.0;   // VS bonus when team has completed 0% of boxes
const CHALLENGE_BONUS_MIN = 1.0;   // VS bonus when team has completed all non-VS boxes
const MIN_BONUS = 0.9;
const MAX_BONUS = 1.3;

/**
 * Compute the current VS challenge bonus multiplier for a team.
 * Declines linearly from CHALLENGE_BONUS_MAX → CHALLENGE_BONUS_MIN
 * as the team completes more boxes. Encourages tackling VS early.
 */
export function getChallengeBonus(room, teamId) {
  const mb = room.mysteryBox;
  if (!mb) return CHALLENGE_BONUS_MAX;

  const tb = mb.teamBoxes?.[teamId];
  if (!tb) return CHALLENGE_BONUS_MAX;

  const totalBoxes = mb.taskCount || 1;
  // Count non-VS boxes total and completed
  const nonVsTotal = tb.order.filter((_, pos) => {
    const taskIdx = tb.order[pos];
    return !mb.interTeamIndices.includes(taskIdx);
  }).length || 1;
  const completedCount = tb.completed.length;

  // Progress based on completed boxes (all types) vs non-VS total
  const progress = Math.min(1, completedCount / nonVsTotal);

  // Linear decline: 2.0 at 0% → 1.0 at 100%
  const bonus = CHALLENGE_BONUS_MAX - progress * (CHALLENGE_BONUS_MAX - CHALLENGE_BONUS_MIN);
  return Math.round(bonus * 100) / 100; // round to 2 decimals
}

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

    // Compute the current VS bonus for this team (declines as they complete boxes)
    const vsBonus = isInterTeam ? getChallengeBonus(room, teamId) : null;

    return {
      boxPos,
      // Only reveal task details if opened
      taskType: isOpened ? task?.taskType : null,
      taskTitle: isOpened ? task?.title : null,
      isInterTeam: isInterTeam, // hint shown on closed box
      vsBonus: isInterTeam && !isCompleted ? vsBonus : null, // declining VS bonus (shown on badge)
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

  // If activeBox is stuck on a COMPLETED box (stale state), auto-clear it
  if (tb.activeBox !== null && tb.completed.includes(tb.activeBox)) {
    console.warn(`[mysteryBox] Auto-clearing stale activeBox=${tb.activeBox} for team ${teamId}`);
    tb.activeBox = null;
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

// ================================
// MILESTONE BONUS CARDS
// ================================
// Riddles, treats, and mystery clues pop up at completion milestones
// (positions 2 through totalBoxes-1). These fire based on how many
// boxes a team has completed, not which box they picked.

const RIDDLE_POOL = [
  { riddle: "I have cities, but no houses live there. I have mountains, but no trees grow there. I have water, but no fish swim there. What am I?", answer: "A map!" },
  { riddle: "The more you take, the more you leave behind. What am I?", answer: "Footsteps!" },
  { riddle: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", answer: "An echo!" },
  { riddle: "What has keys but can't open locks?", answer: "A piano!" },
  { riddle: "I can be cracked, made, told, and played. What am I?", answer: "A joke!" },
  { riddle: "What gets wetter the more it dries?", answer: "A towel!" },
  { riddle: "I have hands but can't clap. What am I?", answer: "A clock!" },
  { riddle: "What can travel around the world while staying in a corner?", answer: "A stamp!" },
  { riddle: "What has a head and a tail but no body?", answer: "A coin!" },
  { riddle: "What building has the most stories?", answer: "A library!" },
];

/**
 * Build riddle milestone positions (fixed, fun, no engagement gate).
 * Returns a Map<completionCount, riddleCard>.
 */
function buildRiddleSchedule(totalBoxes, ridSeed = 0) {
  const schedule = new Map();
  if (totalBoxes < 4) return schedule;

  const positions = [];
  if (totalBoxes <= 6) {
    positions.push(Math.round(totalBoxes * 0.5));
  } else if (totalBoxes <= 10) {
    positions.push(Math.max(2, Math.round(totalBoxes * 0.3)));
    positions.push(Math.min(totalBoxes - 1, Math.round(totalBoxes * 0.75)));
  } else {
    positions.push(Math.max(2, Math.round(totalBoxes * 0.25)));
    positions.push(Math.round(totalBoxes * 0.55));
    positions.push(Math.min(totalBoxes - 1, Math.round(totalBoxes * 0.8)));
  }

  let ridIdx = Math.abs(ridSeed) % RIDDLE_POOL.length;
  for (const at of positions) {
    const clamped = Math.max(2, Math.min(totalBoxes - 1, at));
    if (schedule.has(clamped)) continue;
    schedule.set(clamped, {
      type: "riddle",
      ...RIDDLE_POOL[ridIdx % RIDDLE_POOL.length],
    });
    ridIdx++;
  }
  return schedule;
}

/**
 * Compute a team's live engagement score (0-100) from their submissions.
 * Combines: accuracy (40%), effort/non-skip rate (30%), response pace (30%).
 *
 * A team that answers correctly and promptly scores high.
 * A team that skips, guesses randomly, or stalls scores low.
 */
export function computeTeamEngagement(room, teamId) {
  const subs = (room.submissions || []).filter(s => s.teamId === teamId);
  if (subs.length === 0) return 0;

  // 1) Accuracy: fraction of correct answers (40%)
  const correctCount = subs.filter(s => s.correct === true).length;
  const scoredCount = subs.filter(s => s.correct !== null && s.correct !== undefined).length;
  const accuracy = scoredCount > 0 ? correctCount / scoredCount : 0.5; // neutral if unscored

  // 2) Effort: fraction of submissions with meaningful answers (30%)
  //    Skip/blank = low effort. Any real content = effort.
  const effortCount = subs.filter(s => {
    if (s.points > 0) return true; // earned points = effort
    const a = s.answer;
    if (!a) return false;
    if (typeof a === "string") return a.trim().length > 0;
    if (typeof a === "object") {
      // Check for skip markers
      if (a.skipped) return false;
      if (a.autoComplete && !a.answer) return false;
      return true;
    }
    return true;
  }).length;
  const effort = effortCount / subs.length;

  // 3) Pace: are they answering within reasonable time? (30%)
  //    Median response time < 90s = great, > 180s = sluggish
  const times = subs.map(s => s.timeMs).filter(t => typeof t === "number" && t > 0);
  let pace = 0.5; // neutral default
  if (times.length > 0) {
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // 30s or less = 1.0, 180s+ = 0.0, linear between
    pace = Math.max(0, Math.min(1, 1 - (median - 30000) / 150000));
  }

  const score = Math.round((accuracy * 40 + effort * 30 + pace * 30));
  return Math.max(0, Math.min(100, score));
}

// Engagement threshold for treat eligibility (0-100)
const TREAT_ENGAGEMENT_THRESHOLD = 40;

/**
 * Check if a team just hit a milestone after completing a box.
 * Returns a bonus card object or null.
 *
 * Riddles: fire at fixed positions (just fun, no gate).
 * Treats: randomly placed within 30%-80% window, gated by engagement.
 *   - Team must have engagement score >= TREAT_ENGAGEMENT_THRESHOLD
 *   - Position is randomized per team (seeded) so it's unpredictable
 *   - Max 1 treat per team per session
 */
export function checkMilestoneBonus(room, teamId) {
  const mb = room.mysteryBox;
  if (!mb) return null;

  const tb = mb.teamBoxes?.[teamId];
  if (!tb) return null;

  const completedCount = tb.completed.length;
  const totalBoxes = mb.taskCount || 0;
  if (totalBoxes < 4) return null;

  // Track which milestones this team has already seen
  if (!tb._seenMilestones) tb._seenMilestones = new Set();
  if (tb._seenMilestones.has(completedCount)) return null;

  // 1) Check riddle schedule (fixed positions, always fires)
  const seed = teamId ? teamId.charCodeAt(0) + teamId.charCodeAt(teamId.length - 1) : 0;
  const riddleSchedule = buildRiddleSchedule(totalBoxes, seed);
  const riddleCard = riddleSchedule.get(completedCount);
  if (riddleCard) {
    tb._seenMilestones.add(completedCount);
    return { ...riddleCard, completedCount, totalBoxes };
  }

  // 2) Check treat eligibility (random position in 30%-80% window, engagement-gated)
  if (tb._treatAwarded) return null; // max 1 treat per team

  const minTreatBox = Math.max(2, Math.ceil(totalBoxes * 0.3));
  const maxTreatBox = Math.floor(totalBoxes * 0.8);
  if (completedCount < minTreatBox || completedCount > maxTreatBox) return null;

  // Determine this team's randomized treat position (stable per team)
  // Use a simple hash so it's the same every time but different per team.
  // Avoids riddle positions so both can fire.
  if (tb._treatTargetBox === undefined) {
    const riddlePositions = new Set(buildRiddleSchedule(totalBoxes, seed).keys());
    let h = 0;
    const s = String(teamId || "treat");
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;

    // Build list of valid positions (in window, not a riddle position)
    const valid = [];
    for (let pos = minTreatBox; pos <= maxTreatBox; pos++) {
      if (!riddlePositions.has(pos)) valid.push(pos);
    }
    if (valid.length > 0) {
      tb._treatTargetBox = valid[Math.abs(h) % valid.length];
    } else {
      // Fallback: all positions in window are riddles — pick midpoint
      tb._treatTargetBox = Math.round((minTreatBox + maxTreatBox) / 2);
    }
  }

  if (completedCount !== tb._treatTargetBox) return null;

  // Engagement gate — compute live engagement score
  const engagement = computeTeamEngagement(room, teamId);
  if (engagement < TREAT_ENGAGEMENT_THRESHOLD) {
    // Not engaged enough — skip treat silently (don't block the position)
    tb._seenMilestones.add(completedCount);
    console.log(`[milestone] Team ${teamId} skipped treat — engagement ${engagement} < ${TREAT_ENGAGEMENT_THRESHOLD}`);
    return null;
  }

  tb._seenMilestones.add(completedCount);
  tb._treatAwarded = true;

  return {
    type: "treat",
    message: "Your team earned a treat! See your teacher.",
    engagement,
    completedCount,
    totalBoxes,
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
  const bonus = getChallengeBonus(room, fromTeamId);

  mb.challenges[challengeId] = {
    challengeId,
    fromTeamId,
    taskIndex,
    boxPos, // box position in the challenger's grid
    bonusMultiplier: bonus, // declining bonus based on progress
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

  // Queue this as the acceptor's next task — use the challenge's bonus
  // (locked in when the challenger opened the box, so both sides get same rate)
  tb.challengeQueued = {
    challengeId,
    taskIndex: ch.taskIndex,
    boxPos: acceptorBoxPos >= 0 ? acceptorBoxPos : null,
    bonusMultiplier: ch.bonusMultiplier || 1.5,
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
