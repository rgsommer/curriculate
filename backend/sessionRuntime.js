// backend/sessionRuntime.js
// Central runtime logic for:
//  - Ambient noise aggregation (multi-tablet)
//  - Teacher noise threshold control
//  - Random treat rewards on task submission

// This module assumes:
//  - You have a Session model with fields like:
//      - code (room code)
//      - teams: [{ _id, name, color, ... }]
//      - taskSet: reference to TaskSet
//      - currentTaskIndex: number
//      - randomTreatState: stored in Mongo (or you can keep in memory if preferred)
//  - Your TaskSet has randomTreatConfig (see below).
//
// You will need to call:
//  - initSessionRuntime(io) once at startup
//  - registerSessionRuntimeHandlers(io, socket) for each new socket connection
//  - configureRandomTreatsForSession(session) when a session starts (after teams & taskSet known)
//  - notifyTaskSubmitted({ sessionId, teamId, taskIndex }) when a team submits a task
//
// Adjust to match your actual models & wiring.

import mongoose from "mongoose";
// import Session from "./models/Session.js"; // Uncomment and adjust the path to your Session model

// ---------- In-memory state ----------

// Noise: sessionId -> Map<teamId, { level, speakingAllowed, lastUpdated }>
const noiseBySession = new Map();

// Noise thresholds: sessionId -> { threshold: number | null }
const noiseThresholdBySession = new Map();

// Random treats: sessionId -> random treat state
// We keep a shadow copy in memory for speed; you can also lean on Mongo only.
const randomTreatStateBySession = new Map();

/**
 * Get your Session model.
 * You can replace this with a direct import if you prefer.
 */
function getSessionModel() {
  try {
    return mongoose.model("Session");
  } catch {
    // Adjust this if your Session is exported differently
    return null;
  }
}

// ---------- Random Treats ----------

/**
 * Initialize random treats for a session.
 *
 * Assumes:
 *  - session.teams is an array of team docs
 *  - session.taskSet has a `randomTreatConfig` field:
 *      {
 *        enabled: boolean,
 *        mode: "fixed" | "multiplier",
 *        fixedCount?: number,
 *        perTeamMultiplier?: number,
 *        trigger?: "on-task-start" | "on-submission"
 *      }
 *
 * Call this once when the session is created or when the TaskSet is attached
 * (after teams and taskSet are known).
 *
 * @param {object} session - Mongoose Session doc
 * @returns {Promise<void>}
 */
export async function configureRandomTreatsForSession(session) {
  const randomConfig = session?.taskSet?.randomTreatConfig;
  if (!randomConfig?.enabled) {
    session.randomTreatState = {
      enabled: false,
      trigger: "on-submission",
      treatSlots: [],
    };
    await session.save();
    randomTreatStateBySession.set(session._id.toString(), session.randomTreatState);
    return;
  }

  const teams = session.teams || [];
  const tasks = session.taskSet.tasks || [];
  const numTeams = teams.length;
  const numTasks = tasks.length || 1;

  if (!numTeams || !numTasks) {
    session.randomTreatState = {
      enabled: false,
      trigger: "on-submission",
      treatSlots: [],
    };
    await session.save();
    randomTreatStateBySession.set(session._id.toString(), session.randomTreatState);
    return;
  }

  const { mode, fixedCount, perTeamMultiplier, trigger } = randomConfig;

  const treatQuota =
    mode === "fixed"
      ? (fixedCount ?? 0)
      : (perTeamMultiplier ?? 1) * numTeams;

  // For now, we'll ensure each team gets at most 1 treat
  const maxDistinctTreats = Math.min(treatQuota, numTeams);

  const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
  const rewardedTeams = shuffledTeams.slice(0, maxDistinctTreats);

  const treatSlots = rewardedTeams.map((team) => ({
    teamId: team._id.toString(),
    taskIndex: Math.floor(Math.random() * numTasks),
    used: false,
  }));

  const randomTreatState = {
    enabled: true,
    trigger: trigger || "on-submission", // default to on submission
    treatSlots,
  };

  session.randomTreatState = randomTreatState;
  await session.save();

  randomTreatStateBySession.set(session._id.toString(), randomTreatState);
}

/**
 * Internal helper to load random treat state into memory if missing.
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
async function ensureRandomTreatState(sessionId) {
  let state = randomTreatStateBySession.get(sessionId);
  if (state) return state;

  const Session = getSessionModel();
  if (!Session) return null;

  const session = await Session.findById(sessionId).lean().exec();
  if (!session) return null;

  state = session.randomTreatState || {
    enabled: false,
    trigger: "on-submission",
    treatSlots: [],
  };
  randomTreatStateBySession.set(sessionId, state);
  return state;
}

/**
 * Notify the runtime that a team has submitted a task.
 * Call this from your task submission controller or via socket.
 *
 * @param {object} params
 * @param {import("socket.io").Server} params.io
 * @param {string} params.sessionId
 * @param {string} params.teamId
 * @param {number} params.taskIndex
 */
export async function notifyTaskSubmitted({ io, sessionId, teamId, taskIndex }) {
  // Random treats
  const rtState = await ensureRandomTreatState(sessionId);
  if (rtState?.enabled && rtState.trigger === "on-submission") {
    const slot = rtState.treatSlots?.find(
      (s) => !s.used && s.teamId === teamId && s.taskIndex === taskIndex
    );
    if (slot) {
      slot.used = true;
      // Persist: update DB and memory
      const Session = getSessionModel();
      if (Session) {
        await Session.updateOne(
          { _id: sessionId, "randomTreatState.treatSlots.teamId": teamId },
          {
            $set: {
              "randomTreatState.treatSlots.$.used": true,
            },
          }
        ).exec();
      }
      randomTreatStateBySession.set(sessionId, rtState);

      // Emit to that team: RANDOM_TREAT_AWARDED
      const teamRoom = getTeamRoomId(sessionId, teamId);
      io.to(teamRoom).emit("RANDOM_TREAT_AWARDED", {
        sessionId,
        teamId,
        message: "🎁 Surprise! See your teacher for a treat.",
      });

      // Emit to session (HostView / LiveSession): TEAM_TREAT_ASSIGNED
      io.to(sessionId).emit("TEAM_TREAT_ASSIGNED", {
        sessionId,
        teamId,
        taskIndex,
      });
    }
  }

  // If you later support "on-task-start", you can call a similar helper
  // from your "advance task" controller instead.
}

/**
 * Helper to determine the room name for a specific team.
 * Adjust this to match your socket.io room strategy.
 */
function getTeamRoomId(sessionId, teamId) {
  // Example: `session:<sessionId>:team:<teamId>`
  return `session:${sessionId}:team:${teamId}`;
}

// ---------- Noise Control ----------

/**
 * Called when the teacher moves the noise slider.
 * threshold: 0..1, or null for "don't control noise".
 */
export function setSessionNoiseThreshold(sessionId, threshold) {
  if (!sessionId) return;
  if (threshold == null || Number.isNaN(threshold)) {
    noiseThresholdBySession.set(sessionId, { threshold: null });
  } else {
    const clamped = Math.min(1, Math.max(0, threshold));
    noiseThresholdBySession.set(sessionId, { threshold: clamped });
  }
}

/**
 * Register runtime socket handlers for a single socket:
 *  - STUDENT_NOISE_SAMPLE (from student tablets)
 *  - TEACHER_SET_NOISE_THRESHOLD (from HostView slider)
 *  - TASK_SUBMITTED (optional socket-based signal for task submission)
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
export function registerSessionRuntimeHandlers(io, socket) {
  // --- Noise: per-tablet samples ---
  socket.on("STUDENT_NOISE_SAMPLE", (payload) => {
    const { sessionId, teamId, level, speakingAllowed, active } = payload || {};
    if (!sessionId || !teamId) return;

    if (!noiseBySession.has(sessionId)) {
      noiseBySession.set(sessionId, new Map());
    }
    const teamMap = noiseBySession.get(sessionId);

    if (active === false) {
      teamMap.delete(teamId);
      return;
    }

    if (typeof level !== "number" || level < 0) return;

    teamMap.set(teamId, {
      level,
      speakingAllowed: !!speakingAllowed,
      lastUpdated: Date.now(),
    });
  });

  // --- Noise: teacher threshold slider ---
  socket.on("TEACHER_SET_NOISE_THRESHOLD", (payload) => {
    const { sessionId, threshold } = payload || {};
    if (!sessionId) return;

    // TODO: assert that this socket is the teacher/host for that session.
    setSessionNoiseThreshold(sessionId, threshold);

    const tEntry = noiseThresholdBySession.get(sessionId) || { threshold: null };
    io.to(sessionId).emit("SESSION_NOISE_LEVEL", {
      sessionId,
      medianLevel: null,
      threshold: tEntry.threshold,
    });
  });

  // --- Optional: TASK_SUBMITTED via socket ---
  // If you use HTTP for task submission, you can ignore this
  // and just call notifyTaskSubmitted({ io, sessionId, teamId, taskIndex }) from your controller.
  socket.on("TASK_SUBMITTED", async (payload) => {
    const { sessionId, teamId, taskIndex } = payload || {};
    if (!sessionId || !teamId || typeof taskIndex !== "number") return;

    await notifyTaskSubmitted({ io, sessionId, teamId, taskIndex });
  });
}

/**
 * Initialize the runtime periodic loop(s).
 *  - Aggregates noise from all teams and emits SESSION_NOISE_LEVEL once per second.
 *
 * Call this once at startup, after creating io.
 *
 * @param {import("socket.io").Server} io
 */
export function initSessionRuntime(io) {
  // Noise aggregation: 1x/sec
  setInterval(() => {
    const now = Date.now();

    for (const [sessionId, teamMap] of noiseBySession.entries()) {
      /** @type {number[]} */
      const activeLevels = [];

      for (const [teamId, sample] of teamMap.entries()) {
        const age = now - sample.lastUpdated;
        if (age > 4000) {
          teamMap.delete(teamId);
          continue;
        }

        if (sample.speakingAllowed) {
          // ignore teams explicitly in speaking prompts
          continue;
        }

        activeLevels.push(sample.level);
      }

      let medianLevel = null;
      if (activeLevels.length > 0) {
        activeLevels.sort((a, b) => a - b);
        const mid = Math.floor(activeLevels.length / 2);
        medianLevel =
          activeLevels.length % 2 === 0
            ? (activeLevels[mid - 1] + activeLevels[mid]) / 2
            : activeLevels[mid];
      }

      const tEntry = noiseThresholdBySession.get(sessionId) || { threshold: null };

      io.to(sessionId).emit("SESSION_NOISE_LEVEL", {
        sessionId,
        medianLevel,
        threshold: tEntry.threshold, // null means: teacher chose "don't control noise"
      });
    }
  }, 1000);
}
