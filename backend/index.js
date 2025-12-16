// ====================================================================
//  Curriculate Backend – Rooms, Teams, Stations, Tasks, AI, Emailing
// ====================================================================

import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import Session from "./models/Session.js"; // Or LiveSession if renamed

import TaskSet from "./models/TaskSet.js";
import TeacherProfile from "./models/TeacherProfile.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import TeamSession from "./models/TeamSession.js"; // NEW IMPORT

import { generateAIScore } from "./ai/aiScoring.js";
import { generateSessionSummaries } from "./ai/sessionSummaries.js";
import { sendTranscriptEmail } from "./email/transcriptEmailer.js";
import { generateAiTaskset } from "./controllers/aiTasksetController.js";
import {
  listSessions,
  getSessionDetails,
} from "./controllers/analyticsController.js";
import authRoutes from "./routes/auth.js";
import { authRequired } from "./middleware/authRequired.js";
import { TASK_TYPE_META } from "../shared/taskTypes.js";
import { COLORS } from "../shared/colors.js";

const app = express();
const server = http.createServer(app);

app.use(express.static("public")); // ← serves backend/public/index.html at /

// Simple UUID generator
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

//const raceWinner = {};
const teamClues = new Map(); // ← global store for mystery clues

function getSessionByRoomCode(code) {
  return rooms[code.toUpperCase()];
}

const POST_SUBMIT_SECONDS = Number(process.env.POST_SUBMIT_SECONDS || 10);

function updateTeamScore(room, teamId, points) {
  // room may be a room object or (in some legacy calls) a roomCode string
  let targetRoom = room;
  if (!targetRoom || !targetRoom.teams) {
    if (typeof room === "string") {
      targetRoom = getSessionByRoomCode(room) || null;
    }
  }
  if (targetRoom?.teams?.[teamId]) {
    targetRoom.teams[teamId].score =
      (targetRoom.teams[teamId].score || 0) + points;
  }
}

function getRandomTeam(roomCode) {
  const room = rooms[roomCode];
  const teams = Object.values(room?.teams || {});
  return teams.length > 0
    ? teams[Math.floor(Math.random() * teams.length)]
    : { teamName: "Team" };
}

// ====================================================================
//  CORS
// ====================================================================
const allowedOrigins = [
  "https://set.curriculate.net",
  "https://play.curriculate.net",
  "https://curriculate.net",
  "https://www.curriculate.net",
  "https://api.curriculate.net",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://localhost:3000",
];

let raceWinner = {};

function isVercelPreview(origin) {
  return origin && origin.endsWith(".vercel.app");
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || isVercelPreview(origin)) {
      return callback(null, true);
    }
    console.warn("❌ Blocked CORS:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ====================================================================
//  EXPRESS MIDDLEWARE
// ====================================================================
app.use(bodyParser.json({ limit: "3mb" }));
app.use("/api/subscription", subscriptionRoutes);
app.use("/auth", authRoutes);

// ====================================================================
//  SOCKET.IO
// ====================================================================
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman)
      if (!origin) return callback(null, true);

      const allowed = allowedOrigins;

      if (
        allowed.some((allowedOrigin) => origin.startsWith(allowedOrigin)) ||
        origin.endsWith(".vercel.app")
      ) {
        callback(null, true);
      } else {
        console.warn("Socket.IO CORS blocked:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  },
});

// --------------------------------------------------------------------
// MongoDB Connection
// --------------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not defined in environment!");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Mongo connected"))
  .catch((err) => console.error("Mongo connection error:", err));

// ====================================================================
//  ROOM ENGINE (In-Memory)
// ====================================================================
const rooms = {}; // rooms["AB"] = { teacherSocketId, teams, stations, taskset, ... }
const OFFLINE_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes

// Keep-alive server interval that broadcasts available rooms every ~5–10 seconds
setInterval(() => {
  const now = Date.now();
  const available = Object.values(rooms)
    // A room is "available" if the teacher heartbeat is still fresh.
    // We also keep ACTIVE rooms visible for late joiners even after launch.
    .filter((r) => {
      if (!r) return false;
      const alive = r.expiresAt == null || r.expiresAt > now;
      if (!alive) return false;
      return !!(r.teacherSocketId || r.isActive || r.taskset);
    })
    .map((r) => ({
      roomCode: r.code,
      locationCode: r.locationCode || "Classroom",
      isActive: !!r.isActive,
      startedAt: r.startedAt || null,
      teamCount: Object.keys(r.teams || {}).length,
      lastTeacherSeenAt: r.lastTeacherSeenAt || null,
    }));

  io.emit("rooms:available", available);
}, 20000);

async function createRoom(roomCode, teacherSocketId, locationCode = "Classroom") {
  const stations = {};
  const NUM_STATIONS = 8;
  for (let i = 1; i <= NUM_STATIONS; i++) {
    const id = `station-${i}`;
    stations[id] = { id, assignedTeamId: null };
  }

  const room = {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
    // Heartbeat/availability
    lastTeacherSeenAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour rolling expiry
    teams: {},
    stations,
    taskset: null,
    taskIndex: -1,
    submissions: [],
    startedAt: null,
    isActive: false,
    locationCode, // e.g. "Classroom"

    // Random-treats state
    treatsConfig: {
      enabled: true,
      total: 4,
      given: 0,
    },
    pendingTreats: {}, // teamId -> true

    // Noise-control state
    noiseControl: {
      enabled: false,
      threshold: 0, // 0–100; 0 ⇒ off
    },
    noiseLevel: 0, // smoothed noise measure (0–100)
    noiseBrightness: 1, // 1 = full bright, ~0.3 = dim
    tasks: [], // legacy quick-task array (kept for future use)
    currentTaskIndex: -1, // legacy
    selectedRooms: null, // prevents crash in join-room

    // ==== BRAINSTORM BATTLE STATE ====
    // We keep a per-room object keyed by a "task key" so multiple
    // brainstorm tasks in a set don't overwrite each other.
    brainstormBattles: {
      // [taskKey]: {
      //   taskKey,
      //   startedAt,
      //   ideasByTeam: { [teamId]: string[] }
      // }
    },

    // ==== MAD DASH SEQUENCE STATE ====
    // Filled only when a mad-dash game is running
    madDashSequence: null,
    diffDetectiveRace: null,
    flashcardsRace: null,
  };

  // Load existing teams from DB
  const existingTeams = await TeamSession.find({ roomCode });
  for (const t of existingTeams) {
    const teamId = t._id.toString();
    room.teams[teamId] = {
      teamId,
      teamName: t.teamName,
      members: Array.isArray(t.members) ? t.members : [],
      score: 0,
      stationColor: null,
      currentStationId: null,
      taskIndex: -1,
      status: t.status,
      lastSeenAt: t.lastSeenAt,
    };
  }

  return room;
}

// All-team rotation (kept for possible future use)
function reassignStations(room) {
  const stationIds = Object.keys(room.stations || {});
  const teamIds = Object.keys(room.teams || {});
  if (stationIds.length === 0 || teamIds.length === 0) return;

  if (typeof room._stationRound !== "number") {
    room._stationRound = 0;
  }
  room._stationRound += 1;

  stationIds.forEach((id) => {
    room.stations[id].assignedTeamId = null;
  });

  const sortedTeams = [...teamIds].sort();

  sortedTeams.forEach((teamId, index) => {
    const stationIdx = (index + room._stationRound) % stationIds.length;
    const stationId = stationIds[stationIdx];

    const team = room.teams[teamId];
    if (!team) return;

    team.currentStationId = stationId;
    team.lastScannedStationId = null;
    if (!room.stations[stationId]) {
      room.stations[stationId] = { id: stationId, assignedTeamId: null };
    }
    room.stations[stationId].assignedTeamId = teamId;
  });
}

// Reassign only a single team's station, ensuring uniqueness
function reassignStationForTeam(room, teamId) {
  const stationIds = Object.keys(room.stations || {});
  if (stationIds.length === 0) return;

  const team = room.teams?.[teamId];
  if (!team) return;

  const current = team.currentStationId || null;

  // Stations occupied by OTHER teams
  const occupiedByOthers = new Set(
    Object.entries(room.stations || {})
      .filter(([id, s]) => s.assignedTeamId && s.assignedTeamId !== teamId)
      .map(([id]) => id)
  );

  // Prefer stations that are:
  //  - not the current one
  //  - not occupied by other teams
  const candidates = stationIds.filter(
    (id) => id !== current && !occupiedByOthers.has(id)
  );

  // Fallbacks if all stations are technically “occupied”
  const nextStationId =
    candidates[0] ||
    stationIds.find((id) => id !== current) ||
    stationIds[0];

  // Clear old station assignment (for this team)
  if (
    current &&
    room.stations[current] &&
    room.stations[current].assignedTeamId === teamId
  ) {
    room.stations[current].assignedTeamId = null;
  }

  // Set new station
  team.currentStationId = nextStationId;
  team.lastScannedStationId = null; // force new scan

  if (!room.stations[nextStationId]) {
    room.stations[nextStationId] = { id: nextStationId, assignedTeamId: null };
  }

  // 🔹 Reserve this station for this team
  room.stations[nextStationId].assignedTeamId = teamId;
}

function buildTranscript(room) {
  const taskset = room.taskset;
  const tasks = taskset?.tasks || [];

  const taskRecords = tasks.map((t, i) => ({
    index: i,
    title: t.title || t.taskType,
    taskType: t.taskType,
    prompt: t.prompt,
    points: t.points ?? 10,
  }));

  const teamScores = {};
  for (const sub of room.submissions) {
    if (!teamScores[sub.teamId]) {
      teamScores[sub.teamId] = {
        teamId: sub.teamId,
        teamName: sub.teamName,
        totalPoints: 0,
        attempts: 0,
      };
    }
    teamScores[sub.teamId].totalPoints += sub.points ?? 0;
    teamScores[sub.teamId].attempts += 1;
  }

  return {
    roomCode: room.code,
    startedAt: room.startedAt,
    completedAt: Date.now(),
    tasks: taskRecords,
    scores: teamScores,
    submissions: room.submissions,
  };
}

function computePerParticipantStats(room, transcript) {
  const tasks = transcript.tasks || [];
  const tasksByIndex = {};
  tasks.forEach((t) => (tasksByIndex[t.index] = t));

  const participants = {};

  for (const sub of room.submissions) {
    const key = `${sub.teamId}::${sub.playerId}`;
    if (!participants[key]) {
      participants[key] = {
        teamId: sub.teamId,
        teamName: sub.teamName,
        studentName: sub.playerId,
        attempts: 0,
        correctCount: 0,
        pointsEarned: 0,
        pointsPossible: 0,
      };
    }

    const entry = participants[key];
    entry.attempts += 1;
    if (sub.correct) entry.correctCount += 1;
    entry.pointsEarned += sub.points ?? 0;

    const taskMeta = tasksByIndex[sub.taskIndex];
    if (taskMeta) {
      entry.pointsPossible += taskMeta.points ?? 10;
    }
  }

  const totalTasks = tasks.length;

  return Object.values(participants).map((p) => ({
    ...p,
    engagementPercent:
      totalTasks > 0 ? Math.round((p.attempts / totalTasks) * 100) : 0,
    finalPercent:
      p.pointsPossible > 0
        ? Math.round((p.pointsEarned / p.pointsPossible) * 100)
        : 0,
  }));
}

function buildRoomState(room) {
  if (!room) {
    return {
      code: null,
      locationCode: "Classroom",
      teams: {},
      stations: [],
      scores: {},
      taskIndex: -1,
      startedAt: null,
      isActive: false,

      treatsConfig: {
        enabled: true,
        total: 4,
        given: 0,
      },
      pendingTreatTeams: [],

      noise: {
        enabled: false,
        threshold: 0,
        level: 0,
        brightness: 1,
      },

      brainstorm: null,
      selectedRooms: [],
    };
  }

  const stationsArray = Object.values(room.stations || {});

  // Build scores from submissions, not team.score
  const scores = {};
  for (const sub of room.submissions || []) {
    if (!scores[sub.teamId]) scores[sub.teamId] = 0;
    scores[sub.teamId] += sub.points ?? 0;
  }

  // Detect a one-off Quick Task "taskset" so it doesn’t turn on the
  // full task-flow UI in LiveSession
  const isQuickTaskset =
    !!room.taskset &&
    room.taskset.name === "Quick task" &&
    Array.isArray(room.taskset.tasks) &&
    room.taskset.tasks.length === 1;

  // Derive an "overall" taskIndex for display...
  let overallTaskIndex = -1;

  if (!isQuickTaskset) {
    overallTaskIndex =
      typeof room.taskIndex === "number" ? room.taskIndex : -1;

    const perTeamIndices = Object.values(room.teams || {}).map((t) =>
      typeof t.taskIndex === "number" ? t.taskIndex : -1
    );

    if (perTeamIndices.length > 0) {
      const maxTeamIndex = Math.max(...perTeamIndices);
      if (maxTeamIndex > overallTaskIndex) {
        overallTaskIndex = maxTeamIndex;
      }
    }
  }

  const treatsConfig = room.treatsConfig || {
    enabled: true,
    total: 4,
    given: 0,
  };

  const noiseControl = room.noiseControl || { enabled: false, threshold: 0 };

  // ==== BRAINSTORM STATE SUMMARY FOR LIVESession / UI ====
  let brainstormSummary = null;
  if (room.brainstormBattles && typeof room.brainstormBattles === "object") {
    // Take the most recent active battle (if any)
    const entries = Object.values(room.brainstormBattles);
    if (entries.length > 0) {
      const latest = entries.reduce((a, b) =>
        (a.startedAt || 0) > (b.startedAt || 0) ? a : b
      );
      const teams = {};
      Object.entries(latest.ideasByTeam || {}).forEach(([teamId, ideas]) => {
        const team = (room.teams || {})[teamId];
        const label = team?.teamName || `Team-${String(teamId).slice(-4)}`;
        teams[teamId] = {
          teamId,
          teamName: label,
          ideaCount: ideas.length,
        };
      });
      brainstormSummary = {
        taskKey: latest.taskKey,
        startedAt: latest.startedAt,
        teams,
      };
    }
  }

  return {
    code: room.code,
    locationCode: room.locationCode || "Classroom",
    teams: (() => {
      const out = {};
      for (const [teamId, t] of Object.entries(room.teams || {})) {
        if (!t || typeof t !== "object") continue;

        out[teamId] = {
          id: t.id || teamId,
          teamName: t.teamName || t.name || null,
          members: Array.isArray(t.members) ? t.members : [],
          // station assignment
          station: t.station || null,
          currentStationId: t.currentStationId || null,
          lastScannedStationId: t.lastScannedStationId || null,
          locationSlug: t.locationSlug || null,

          // task progression
          taskIndex: typeof t.taskIndex === "number" ? t.taskIndex : -1,
          nextTaskIndex: typeof t.nextTaskIndex === "number" ? t.nextTaskIndex : null,

          // connectivity + misc
          connected: !!t.connected,
          joinedAt: t.joinedAt || null,
          status: t.status || null,
          stale: !!t.stale,
          lastSeenAt: t.lastSeenAt || null,
        };
      }
      return out;
    })(),

    stations: stationsArray,
    scores,
    taskIndex: overallTaskIndex,
    startedAt: room.startedAt || null,
    isActive: !!room.isActive,
    selectedRooms: Array.isArray(room.selectedRooms) ? room.selectedRooms : [],

    // Random treats (for LiveSession UI)
    treatsConfig: {
      enabled: !!treatsConfig.enabled,
      total:
        typeof treatsConfig.total === "number" &&
        !Number.isNaN(treatsConfig.total)
          ? treatsConfig.total
          : 4,
      given:
        typeof treatsConfig.given === "number" &&
        !Number.isNaN(treatsConfig.given)
          ? treatsConfig.given
          : 0,
    },
    pendingTreatTeams: Object.keys(room.pendingTreats || {}),

    // Noise-control state (for LiveSession + StudentApp)
    noise: {
      enabled: !!noiseControl.enabled && (noiseControl.threshold || 0) > 0,
      threshold:
        typeof noiseControl.threshold === "number" &&
        !Number.isNaN(noiseControl.threshold)
          ? noiseControl.threshold
          : 0,
      level:
        typeof room.noiseLevel === "number" && !Number.isNaN(room.noiseLevel)
          ? room.noiseLevel
          : 0,
      brightness:
        typeof room.noiseBrightness === "number" &&
        !Number.isNaN(room.noiseBrightness)
          ? room.noiseBrightness
          : 1,
    },

    // Brainstorm battle – light summary so LiveSession can show counts
    brainstorm: brainstormSummary,
  };
}

function sendTaskToTeam(room, teamId, index) {
  index = Number.isFinite(index) ? index : 0;
  index = Math.max(0, Math.floor(index));

  if (!room?.taskset) return;
  if (!room?.teams?.[teamId]) return;

  const tasks = Array.isArray(room.taskset.tasks) ? room.taskset.tasks : [];
  if (tasks.length === 0) return;

  // If they've finished all tasks, mark complete for this team only
  if (index >= tasks.length) {
    room.teams[teamId].taskIndex = tasks.length;
    io.to(teamId).emit("session:complete");
    return;
  }

  const task = tasks[index];
  if (!task) return;

  // If this is a Diff Detective task, initialise / reset race state
  // the first time any team is sent this particular index.
  if (task.taskType === "diff-detective") {
    if (
      !room.diffDetectiveRace ||
      room.diffDetectiveRace.taskIndex !== index
    ) {
      room.diffDetectiveRace = {
        active: true,
        taskIndex: index,
        startedAt: Date.now(),
        completedTeams: new Set(),
        winnerTeamId: null,
      };

      // Let all clients know a Diff Detective race has started.
      io.to(room.code).emit("diff-detective-race-start", {
        roomCode: room.code,
        taskIndex: index,
        startedAt: room.diffDetectiveRace.startedAt,
      });
    }
  }

  // If this is a Flashcards Race task, initialise race state the first time
  // any team is sent this particular index.
  if (task.taskType === "flashcards-race") {
    if (
      !room.flashcardsRace ||
      room.flashcardsRace.taskIndex !== index
    ) {
      const deck =
        (Array.isArray(task.cards) && task.cards.length > 0
          ? task.cards
          : Array.isArray(task.items) && task.items.length > 0
          ? task.items
          : []) || [];

      room.flashcardsRace = {
        active: deck.length > 0,
        taskIndex: index,
        deck,
        currentIndex: 0,
      };

      // Broadcast initial "start" event so FlashcardsRaceTask can show card 0
      io.to(room.code).emit("flashcards-race:start", {
        card: deck[0] || null,
        cardIndex: 0,
        totalCards: deck.length,
      });
    }
  }

  room.teams[teamId].taskIndex = index;

  const timeLimitSeconds =
    typeof task.timeLimitSeconds === "number"
      ? task.timeLimitSeconds
      : typeof task.time_limit === "number"
      ? task.time_limit
      : null;

  const payload = {
    taskIndex: index, // preferred
    index,            // legacy
    task,
    timeLimitSeconds,
    totalTasks: tasks.length,
  };

  io.to(teamId).emit("task:launch", payload);
  io.to(teamId).emit("task:assigned", payload);
}

// ------------------------------
// Helpers: treats + noise
// ------------------------------
function ensureTreatsConfig(room) {
  if (!room.treatsConfig) {
    room.treatsConfig = {
      enabled: true,
      total: 4,
      given: 0,
    };
  }
  if (!room.pendingTreats) {
    room.pendingTreats = {};
  }
}

function maybeAwardTreat(code, room, teamId) {
  ensureTreatsConfig(room);
  const cfg = room.treatsConfig;
  if (!cfg.enabled) return;
  if (cfg.total <= 0) return;
  if (cfg.given >= cfg.total) return;

  // Simple probability model:
  const remaining = cfg.total - cfg.given;
  const base = Math.min(0.15 * remaining, 0.6); // 0.15, 0.3, 0.45, 0.6...
  const alreadyPending = room.pendingTreats && room.pendingTreats[teamId];
  const chance = alreadyPending ? base * 0.25 : base;

  if (Math.random() > chance) return;

  cfg.given += 1;
  room.pendingTreats[teamId] = true;

  const team = room.teams?.[teamId];
  const teamName = team?.teamName || `Team-${String(teamId).slice(-4)}`;

  // Notify teacher app (LiveSession) and student device.
  io.to(code).emit("teacher:treatAssigned", {
    roomCode: code,
    teamId,
    teamName,
  });
  io.to(teamId).emit("student:treatAssigned", {
    roomCode: code,
    teamId,
    message: "See your teacher for a treat!",
  });
}

function ensureNoiseControl(room) {
  if (!room.noiseControl) {
    room.noiseControl = {
      enabled: false,
      threshold: 0,
    };
  }
  if (typeof room.noiseLevel !== "number") {
    room.noiseLevel = 0;
  }
  if (typeof room.noiseBrightness !== "number") {
    room.noiseBrightness = 1;
  }
}

// Simple deep equal for arrays (for mystery card task)
function arraysDeepEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;
  }
}

function updateNoiseDerivedState(code, room) {
  ensureNoiseControl(room);
  const control = room.noiseControl;

  const enabled = !!control.enabled && (control.threshold || 0) > 0;
  const threshold =
    typeof control.threshold === "number" &&
    !Number.isNaN(control.threshold)
      ? control.threshold
      : 0;
  const level =
    typeof room.noiseLevel === "number" && !Number.isNaN(room.noiseLevel)
      ? room.noiseLevel
      : 0;

  let brightness = 1;
  if (enabled) {
    const center = threshold;
    const band = 15; // +/- range around center
    if (level <= center - band) {
      brightness = 1;
    } else if (level >= center + band) {
      brightness = 0.3;
    } else {
      const t = (level - (center - band)) / (2 * band); // 0 → 1
      brightness = 1 - t * 0.7; // 1 → 0.3
    }
  }

  room.noiseBrightness = brightness;

  // Emit direct noise status (for live meters / dimming)
  io.to(code).emit("session:noiseLevel", {
    roomCode: code,
    level,
    brightness,
    enabled,
    threshold,
  });

  // Also refresh room:state so LiveSession sees latest
  const state = buildRoomState(room);
  io.to(code).emit("room:state", state);
  io.to(code).emit("roomState", state);
}

// ================================
// Task advancement (server-authoritative)
// ================================

const NEXT_TASK_DELAY_MS = 15000;

/**
 * Ensures only ONE pending next-task timer exists per session.
 * Stores timer handles on the session object (in-memory).
 */
function scheduleNextTask({
    io,
    session,
    roomCode,
    delayMs = NEXT_TASK_DELAY_MS,
    reason = "auto",
    baseTaskIndex = null,
  }) {
    if (!session) return;

    // If already scheduled, do nothing (prevents duplicates from multiple submissions)
    if (session._nextTaskTimeout) return;

    const startAt = Date.now();
    session._nextTaskDueAt = startAt + delayMs;

    io.to(roomCode).emit("task:advance-scheduled", {
      dueAt: session._nextTaskDueAt,
      delayMs,
      reason,
    });

    session._nextTaskTimeout = setTimeout(() => {
      session._nextTaskTimeout = null;
      session._nextTaskDueAt = null;

      advanceTaskNow({
        io,
        session,
        roomCode,
        reason: reason === "auto" ? "auto-delay" : reason,
        baseTaskIndex,
      });
    }, delayMs);
  }

function cancelScheduledNextTask(session) {
  if (!session) return;
  if (session._nextTaskTimeout) {
    clearTimeout(session._nextTaskTimeout);
    session._nextTaskTimeout = null;
  }
  session._nextTaskDueAt = null;
}

/**
 * Scan-gated "advance": unlock the next task for ALL teams by setting nextTaskIndex.
 * Does NOT push the task directly (students still must scan).
 */
function advanceTaskNow({ io, session, roomCode, reason = "manual", baseTaskIndex = null }) {
  if (!session) return;

  const tasks = session.taskset?.tasks || session.tasks || session.roomState?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    io.to(roomCode).emit("task:advance-error", { reason: "No tasks found on session." });
    return;
  }

  const teams = session.teams || {};
  const teamIds = Object.keys(teams);

  // Determine which task we're advancing FROM.
  // If caller provides baseTaskIndex, trust it (best for "all teams submitted idx").
  // Otherwise infer from max team.taskIndex.
  const inferredCurrent =
    teamIds.length > 0
      ? Math.max(
          ...teamIds.map((id) =>
            typeof teams[id]?.taskIndex === "number" ? teams[id].taskIndex : -1
          )
        )
      : -1;

  const currentIndex =
    typeof baseTaskIndex === "number" && baseTaskIndex >= 0 ? baseTaskIndex : inferredCurrent;

  const nextIndex = currentIndex + 1;

  if (nextIndex >= tasks.length) {
    // End of taskset
    io.to(roomCode).emit("taskset:ended", { reason });
    io.to(roomCode).emit("session:complete"); // backward compat with older flows
    return;
  }

  // Unlock next task for every team
  for (const id of teamIds) {
    if (!teams[id]) continue;
    teams[id].nextTaskIndex = nextIndex;
  }

  // Broadcast state so TeacherApp + StudentApp see that next is unlocked
  const state = buildRoomState(session);
  io.to(roomCode).emit("room:state", state);
  io.to(roomCode).emit("roomState", state);

  // Optional UI event for teacher dashboards
  io.to(roomCode).emit("task:advance", { taskIndex: nextIndex, reason });
}

// ====================================================================
//  SOCKET.IO – EVENT HANDLERS
// ====================================================================
io.on("connection", (socket) => {
  console.log(
    "[SOCKET] New connection",
    socket.id,
    "origin:",
    socket.handshake.headers.origin,
    "referer:",
    socket.handshake.headers.referer
  );

socket.on("submit:answer", (payload, ack) => {
  handleStudentSubmit(payload, ack);
});

socket.on("task:force-advance", ({ roomCode }) => {
  const session = getSessionByRoomCode(roomCode); // <-- use YOUR existing getter
  if (!session) return;

  // If a 15s timer is pending, cancel it and advance immediately
  cancelScheduledNextTask(session);
  advanceTaskNow({ io, session, roomCode, reason: "teacher-force" });
});

// LOG EVERY EVENT THIS SOCKET EMITS
  socket.onAny((event, ...args) => {
    console.log(
      `[SOCKET ${socket.id}] event:`,
      event,
      "payload keys:",
      args[0] && typeof args[0] === "object"
        ? Object.keys(args[0])
        : typeof args[0]
    );
  });

  // Teacher creates room
  socket.on("teacher:createRoom", async ({ roomCode }, callback) => {
    const code = roomCode?.toUpperCase();
    if (!code) return;

    if (rooms[code]) {
      rooms[code].teacherSocketId = socket.id;
      socket.join(code);

      const state = buildRoomState(rooms[code]);

      // Emit both event names for compatibility
      socket.emit("room:state", state);
      socket.emit("roomState", state);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Keep-alive pulse
      rooms[code].teacherSocketId = socket.id;
        rooms[code].lastTeacherSeenAt = Date.now();
        rooms[code].expiresAt = Date.now() + 1000 * 60 * 60;

        socket.data.role = "teacher";
        socket.data.roomCode = code;

      if (typeof callback === "function") callback({ ok: true, roomCode: code, room: state });
        return;
      }
    console.log(`Teacher created room ${code}`);
    const room = await createRoom(code, socket.id);
    rooms[code] = room;
    console.log(`Room ${code} is now READY for students`);
    socket.join(code);

    // Broadcast initial empty state so LiveSession renders correctly
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // When the teacher creates/claims a room, stamp a heartbeat
    rooms[code].teacherSocketId = socket.id;
    rooms[code].lastTeacherSeenAt = Date.now();
    rooms[code].expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour
    socket.data.role = "teacher";
    socket.data.roomCode = code;
  
    if (typeof callback === "function") callback({ ok: true, roomCode: code, room: state });

  });

  // teacher keepalive event
  socket.on("teacher:keepalive", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    // keep room alive + reconnect-safe ownership
    room.teacherSocketId = socket.id;
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60; // rolling 1-hour expiry

    // IMPORTANT: do NOT mutate room.isActive here

    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;
  });

  // ----------------------------------------------------
  // Student joins a room (persistent student:join-room)
  // ----------------------------------------------------
  const handleStudentJoinRoom = async (payload = {}, ack) => {
    try {
      const { roomCode, teamName, members } = payload || {};
      const code = (roomCode || "").toUpperCase().trim();
      const cleanName = (teamName || "").trim();
      const memberList = Array.isArray(members)
        ? members
            .filter((m) => typeof m === "string")
            .map((m) => m.trim())
            .filter((m) => m.length > 0)
        : [];

      if (!code || !cleanName) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Room code and team name are required." });
        }
        return;
      }

      const room = rooms[code];
      if (!room) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            error: "Room not found. Is your teacher in the room?",
          });
        }
        return;
      }

      // Try to re-use an existing TeamSession for this room + team name,
      // so refreshes don't create duplicates.
      let teamDoc = await TeamSession.findOne({
        roomCode: code,
        teamName: cleanName,
      });

      if (!teamDoc) {
        teamDoc = new TeamSession({
          roomCode: code,
          teamName: cleanName,
          members: memberList,
          status: "online",
          lastSeenAt: new Date(),
        });
        await teamDoc.save();
      } else {
        teamDoc.members = memberList;
        teamDoc.status = "online";
        teamDoc.lastSeenAt = new Date();
        await teamDoc.save();
      }

      const teamId = String(teamDoc._id);

      // Ensure in-memory team object is present & updated
      if (!room.teams[teamId]) {
        room.teams[teamId] = {
          teamId,
          teamName: cleanName,
          members: memberList,
          score: 0,
          status: "online",
          currentStationId: null,
          lastScannedStationId: null,
          taskIndex: -1,
        };
        room.teams[teamId].connected = true;
        room.teams[teamId].stale = false;
        room.teams[teamId].lastSeenAt = new Date();
      } else {
        room.teams[teamId].teamName = cleanName;
        room.teams[teamId].members = memberList;
        room.teams[teamId].status = "online";
        room.teams[teamId].connected = true;
        room.teams[teamId].stale = false;
        room.teams[teamId].lastSeenAt = new Date();
      }

      // Ensure published team assignment is always in currentStationId
      if (!room.teams[teamId].currentStationId) {
        room.teams[teamId].currentStationId =
        room.teams[teamId].stationId ||
        room.teams[teamId].station ||   // <-- if your published teams use this
        null;
      }

      // Cancel any offline cleanup timeout if it exists
      if (room.teams[teamId].offlineTimeout) {
        clearTimeout(room.teams[teamId].offlineTimeout);
        delete room.teams[teamId].offlineTimeout;
      }

      // 🔹 NEW: give this team a starting station so scanning is the first step
      // If the team already has a station, KEEP IT (refresh/rejoin). Only assign if missing.
      if (!room.teams[teamId].currentStationId && room.stations && Object.keys(room.stations).length > 0) {
        reassignStationForTeam(room, teamId);
      }

      // If taskset running, DO NOT push task immediately.
      // Instead, queue it so the NEXT SCAN delivers it.
      // ✅ Only send a task if the session has STARTED
      if (
        room.isActive === true &&
        room.taskset &&
        Array.isArray(room.taskset.tasks) &&
        room.taskset.tasks.length > 0
      ) {
        const idx =
          typeof room.taskIndex === "number" && room.taskIndex >= 0
            ? room.taskIndex
            : typeof room.teams?.[teamId]?.taskIndex === "number" && room.teams[teamId].taskIndex >= 0
            ? room.teams[teamId].taskIndex
            : 0;

        sendTaskToTeam(room, teamId, idx);
      }

      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = cleanName;

      socket.join(code);
      socket.join(teamId);

      const state = buildRoomState(room);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Notify teacher that a team has joined (for LiveSession join sound)
      io.to(code).emit("team:joined", {
        teamId,
        teamName: cleanName,
        members: memberList,
      });

      if (typeof ack === "function") {
        ack({
          ok: true,
          teamId,
          teamSessionId: teamId,
          assignedStationId: room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null,
          assignedColor: normalizeStationId(room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null)?.color || null,
          roomState: state,
        });
      }
    } catch (err) {
      console.error("student:join-room error:", err);
      if (typeof ack === "function") {
        ack({ ok: false, error: "Join failed on server." });
      }
    }
  };

  socket.on("student:join-room", handleStudentJoinRoom);
  socket.on("student-join-room", handleStudentJoinRoom);


  // ----------------------------------------------------
  // Student auto-resume (resume-team-session)
  // ----------------------------------------------------
  socket.on("resume-team-session", async (payload = {}, ack) => {
    try {
      const { roomCode, teamSessionId } = payload || {};
      const code = (roomCode || "").toUpperCase().trim();
      const teamId = String(teamSessionId || "").trim();

      if (!code || !teamId) {
        if (typeof ack === "function") {
          ack({
            success: false,
            error: "Room and team session are required.",
          });
        }
        return;
      }

      const room = rooms[code];
      if (!room || !room.teams || !room.teams[teamId]) {
        if (typeof ack === "function") {
          ack({
            success: false,
            error:
              "Session not found. Ask your teacher to let you re-join the room.",
          });
        }
        return;
      }

      const team = room.teams[teamId];

      // Mark as online + cancel any pending offline timeout
      team.status = "online";
      team.connected = true;
      team.stale = false;
      team.lastSeenAt = new Date();
      
      if (team.offlineTimeout) {
        clearTimeout(team.offlineTimeout);
        delete team.offlineTimeout;
      }

      // Keep DB in sync if we can
      try {
        const dbTeam = await TeamSession.findById(teamId);
        if (dbTeam) {
          dbTeam.status = "online";
          dbTeam.lastSeenAt = new Date();
          await dbTeam.save();
        }
      } catch (err) {
        console.warn("resume-team-session: DB update failed:", err);
      }

      // Re-join socket rooms + tag socket
      socket.join(code);
      socket.join(teamId);
      // ✅ If a taskset is already running, send the current task to this (re)joining team
      if (room.taskset && Array.isArray(room.taskset.tasks) && room.taskset.tasks.length > 0) {
        const idx =
          typeof room.taskIndex === "number" && room.taskIndex >= 0
            ? room.taskIndex
            : typeof room.teams?.[teamId]?.taskIndex === "number"
            ? room.teams[teamId].taskIndex
            : 0;

        sendTaskToTeam(room, teamId, idx);
      }

      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = team.teamName;

      const state = buildRoomState(room);

      if (typeof ack === "function") {
        ack({
          success: true,
          teamId,
          assignedStationId: room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null,
          assignedColor: normalizeStationId(room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null)?.color || null,
          roomState: state,
        });
      }

      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);
    } catch (err) {
      console.error("resume-team-session error:", err);
      if (typeof ack === "function") {
        ack({
          success: false,
          error: "Server error while resuming session.",
        });
      }
    }
  });

  // Student scans station – unified handler for legacy + new flow
  const normalizeRoomCode = (c) => (c || "").trim().toUpperCase();

  // If you already have these elsewhere, delete these two helpers here.
  const normalizeLocationSlug = (s) =>
    (s || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");

  function normalizeStationId(input) {
    const raw = (input || "").toString().trim();
    const lower = raw.toLowerCase();

    // 1) station-<number> anywhere in the string
    const m = lower.match(/station-(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const color = Number.isFinite(n) && n >= 1 ? COLORS[n - 1] || null : null;
      return { id: `station-${n}`, number: n, color };
    }

    // 2) color anywhere in the string (including URLs like .../red or .../202/red)
    // Match whole word colors separated by /, ?, #, &, =, or end of string
    const colorRegex = new RegExp(`(?:^|[\\/\\?#&=])(${COLORS.join("|")})(?:$|[\\/\\?#&=])`, "i");
    const cm = lower.match(colorRegex);
    if (cm) {
      return { id: null, number: null, color: cm[1].toLowerCase() };
    }

    // 3) plain color string (fallback)
    if (COLORS.includes(lower)) {
      return { id: null, number: null, color: lower };
    }

    return { id: null, number: null, color: null };
  }

  const handleStationScan = (payload = {}, ack) => {
    try {
      const { roomCode, teamId, stationId, locationSlug } = payload || {};
      const code = normalizeRoomCode(roomCode);

      // Log AFTER variables exist
      console.log("[scan recv]", {
        rawRoomCode: roomCode,
        code,
        teamId,
        stationId,
        locationSlug,
        hasRoom: !!rooms[code],
        hasTeam: !!rooms?.[code]?.teams?.[teamId],
      });

      // 1) Session validity
      const room = rooms[code];
      const team = room?.teams?.[teamId];
      if (!code || !teamId || !room || !team) {
        console.error("Invalid scan (room/team missing):", { code, teamId });
        if (typeof ack === "function") ack({ ok: false, error: "Invalid session" });
        return;
      }

      // 2) Station correctness
      const expectedStation =
        team.currentStationId || team.stationId || team.station || null;
      const expected = normalizeStationId(expectedStation);
      const scanned = normalizeStationId(stationId);

      // If the team has no expected station yet, accept the scan as the initial assignment
      if (!expectedStation) {
        // persist on team object (wherever your team state lives)
        team.currentStationId = stationId;
        team.lastScannedStationId = stationId;

        // (optional) also store color for convenience
        team.assignedColor = scanned?.color || null;

        if (typeof ack === "function") {
          ack({
            ok: true,
            initialAssignment: true,
            stationId,
            assignedStationId: stationId,
            assignedColor: scanned?.color || null,
          });
        }

        // Also push state so StudentApp gets assignedColor immediately
        io.to(code).emit("room:state", buildRoomState(room)); // or whatever you already use
        return;
      }

      const stationMatches =
        (expected.id && scanned.id && expected.id === scanned.id) ||
        (expected.color && scanned.color && expected.color === scanned.color);

      if (!stationMatches) {
        console.error("Wrong station:", {
          expectedStation,
          expected,
          scannedStation: stationId,
          scanned,
        });

        const scannedLabel =
          (scanned?.color ? String(scanned.color).toUpperCase() : null) ||
          (scanned?.id ? String(scanned.id).toUpperCase() : null) ||
          (stationId ? String(stationId).toUpperCase() : "UNKNOWN");

        const expectedLabel =
          (expected?.color ? String(expected.color).toUpperCase() : null) ||
          (expected?.id ? String(expected.id).toUpperCase() : null) ||
          (expectedStation ? String(expectedStation).toUpperCase() : "YOUR STATION");

        if (typeof ack === "function") {
          ack({
            ok: false,
            // Option A (more helpful)
            error: `You scanned ${scannedLabel}. Go to ${expectedLabel}.`,

            // Option B (less revealing) — swap the error line above for this one:
            // error: `You scanned ${scannedLabel}.`,

            scannedStationId: scanned?.id || stationId || null,
            scannedColor: scanned?.color || null,
            expectedStationId: expected?.id || expectedStation || null,
            expectedColor: expected?.color || null,
          });
        }
        return;
      }

      // 3) Location correctness (multi-room only)
      const isMultiRoom =
        Array.isArray(room.selectedRooms) && room.selectedRooms.length > 1;

      if (isMultiRoom) {
        const expectedLoc = normalizeLocationSlug(team.locationSlug || room.locationCode);
        const scannedLoc = normalizeLocationSlug(locationSlug);

        if (expectedLoc && scannedLoc && expectedLoc !== scannedLoc) {
          if (typeof ack === "function") {
            ack({
              ok: false,
              error: `Go to ${expectedLoc.toUpperCase()} ${String(expected.color || "").toUpperCase()}`.trim(),
            });
          }
          return;
        }
      }

      // ✅ Mark scan accepted
      team.lastScannedStationId = expectedStation || stationId || null;

      // If this team has a queued task, deliver it now
      let deliveredTask = false;

      // If this team has a queued task, deliver it now
      if (room.taskset && Array.isArray(room.taskset.tasks)) {
        const queuedIndex =
          typeof team.nextTaskIndex === "number" && team.nextTaskIndex >= 0
            ? team.nextTaskIndex
            : -1;

        if (queuedIndex >= 0) {
          sendTaskToTeam(room, teamId, queuedIndex);
          delete team.nextTaskIndex;
          deliveredTask = true;
        }
      }

      const waitingForLaunch = !room.isActive; // taskset not launched yet

      if (typeof ack === "function") {
        ack({
          ok: true,
          message: "Correct station!",
          deliveredTask,
          waitingForLaunch,
        });
      }

      // Optional: Scan-and-confirm bonus points
      let currentTask = {};
      if (room.taskset && Array.isArray(room.taskset.tasks)) {
        const idx =
          typeof team.taskIndex === "number" && team.taskIndex >= 0
            ? team.taskIndex
            : typeof room.taskIndex === "number" && room.taskIndex >= 0
            ? room.taskIndex
            : -1;
        currentTask = idx >= 0 ? room.taskset.tasks[idx] || {} : {};
      }

      if (currentTask.taskType === "scan-and-confirm") {
        updateTeamScore(room, teamId, currentTask.points || 10);
      }

    } catch (err) {
      console.error("handleStationScan error:", err);
      if (typeof ack === "function") ack({ ok: false, error: "Server scan error" });
    }
  };

socket.on("station:scan", handleStationScan);

  // ==== BRAINSTORM BATTLE SOCKET EVENTS ====
  // Simple, durable model:
  //  - each brainstorm task has a taskKey
  //  - we collect ideas per team
  //  - broadcast a lightweight scoreboard to all teams
  function getBrainstormBucket(room, taskKey) {
    if (!room.brainstormBattles) {
      room.brainstormBattles = {};
    }
    if (!room.brainstormBattles[taskKey]) {
      room.brainstormBattles[taskKey] = {
        taskKey,
        startedAt: Date.now(),
        ideasByTeam: {},
      };
    }
    return room.brainstormBattles[taskKey];
  }

  function broadcastBrainstormUpdate(code, room, taskKey) {
    const bucket = room.brainstormBattles?.[taskKey];
    if (!bucket) return;

    const teamsPayload = {};
    Object.entries(bucket.ideasByTeam || {}).forEach(([teamId, ideas]) => {
      const team = (room.teams || {})[teamId];
      const label = team?.teamName || `Team-${String(teamId).slice(-4)}`;
      teamsPayload[teamId] = {
        teamId,
        teamName: label,
        ideaCount: ideas.length,
      };
    });

    io.to(code).emit("brainstorm:update", {
      taskKey,
      teams: teamsPayload,
    });

    // Also refresh global roomState so LiveSession can show counts
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  }

  // Teacher can explicitly start a brainstorm battle for a given task
  socket.on("brainstorm:start", (payload = {}) => {
    const { roomCode, taskIndex } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex >= 0
        ? room.taskIndex
        : 0;

    const task = room.taskset.tasks[idx];
    if (!task || task.taskType !== "brainstorm-battle") return;

    const taskKey =
      task._id?.toString?.() || `${room.taskset._id || "set"}:${idx}`;

    const bucket = getBrainstormBucket(room, taskKey);
    bucket.startedAt = Date.now();
    bucket.ideasByTeam = {};

    broadcastBrainstormUpdate(code, room, taskKey);
  });

  // Student sends an idea (called directly from BrainstormBattleTask)
  socket.on("brainstorm:idea", (payload = {}) => {
    try {
      const code = (payload.roomCode || socket.data?.roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) return;

      const teamId = payload.teamId || socket.data?.teamId;
      if (!teamId || !room.teams?.[teamId]) return;

      const taskIndex =
        typeof payload.taskIndex === "number" && payload.taskIndex >= 0
          ? payload.taskIndex
          : room.teams[teamId].taskIndex ?? room.taskIndex ?? 0;

      const task = room.taskset?.tasks?.[taskIndex];
      if (!task || task.taskType !== "brainstorm-battle") return;

      const rawIdea =
        typeof payload.ideaText === "string"
          ? payload.ideaText
          : typeof payload.idea === "string"
          ? payload.idea
          : "";
      const idea = rawIdea.trim();
      if (!idea) return;

      const taskKey =
        task._id?.toString?.() || `${room.taskset._id || "set"}:${taskIndex}`;

      const bucket = getBrainstormBucket(room, taskKey);
      if (!bucket.ideasByTeam[teamId]) {
        bucket.ideasByTeam[teamId] = [];
      }

      // Simple de-duplication (case-insensitive)
      const lowered = idea.toLowerCase();
      const existing = bucket.ideasByTeam[teamId].map((x) => x.toLowerCase());
      if (!existing.includes(lowered)) {
        bucket.ideasByTeam[teamId].push(idea);
      }

      broadcastBrainstormUpdate(code, room, taskKey);
    } catch (err) {
      console.error("Error in brainstorm:idea:", err);
    }
  });

  // Optional: Teacher can reset the battle for that task
  socket.on("brainstorm:reset", (payload = {}) => {
    const { roomCode, taskIndex } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset || !room.brainstormBattles) return;

    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex >= 0
        ? room.taskIndex
        : 0;

    const task = room.taskset.tasks[idx];
    if (!task || task.taskType !== "brainstorm-battle") return;

    const taskKey =
      task._id?.toString?.() || `${room.taskset._id || "set"}:${idx}`;

    if (room.brainstormBattles[taskKey]) {
      delete room.brainstormBattles[taskKey];
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  });

  const handleStudentSubmit = async (payload, ack) => {
    const { roomCode, teamId, taskIndex, timeMs } = payload || {};
    let { answer } = payload || {};

    // ✅ Normalize multi-pack answers sent as JSON strings from StudentApp/TaskRunner
    if (typeof answer === "string") {
      const s = answer.trim();
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try {
          const parsed = JSON.parse(s);

          // TaskRunner sends: { kind: "multi-mc" | "multi-short", answers: [...] }
          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.answers) &&
            parsed.answers.length > 0
          ) {
            const kind = parsed.kind || parsed.type;

            // Convert to the server’s expected shape
            if (kind === "multi-mc" || kind === "multi-choice") {
              answer = { type: "multi-choice", answers: parsed.answers };
            } else if (kind === "multi-short" || kind === "multi-sa") {
              answer = { type: "multi-short", answers: parsed.answers };
            } else if (parsed.type === "multi-choice" || parsed.type === "multi-short") {
              answer = parsed; // already in expected shape
            }
          }
        } catch {
          // Not JSON; keep as plain string answer
        }
      }
    }

const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Room or taskset not found" });
      }
      return;
    }

    const effectiveTeamId = teamId || socket.data.teamId;
    const team = room.teams[effectiveTeamId] || {};

    // Use explicit taskIndex if provided, otherwise this team's current index
    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : typeof team.taskIndex === "number" && team.taskIndex >= 0
        ? team.taskIndex
        : room.taskIndex;

    const task = room.taskset.tasks[idx];
    if (!task) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Task not found" });
      }
      return;
    }

    const teamName =
      team.teamName || `Team-${String(effectiveTeamId).slice(-4)}`;

    const meta = TASK_TYPE_META?.[task.taskType] || {};
    const basePoints = task.points ?? 10;

    // Detect multi-question pack answers from TaskRunner
    const isMultiPack =
      answer &&
      typeof answer === "object" &&
      Array.isArray(answer.answers) &&
      answer.answers.length > 0 &&
      (answer.type === "multi-choice" || answer.type === "multi-short");

    // Build answerText for transcripts/logging
    const answerText = (() => {
      if (isMultiPack) {
        try {
          return answer.answers
            .map((a, i) => {
              const label = a?.prompt || `Q${i + 1}`;
              const val =
                a?.value != null ? String(a.value).trim() : "(no answer)";
              return `${i + 1}) ${label}: ${val}`;
            })
            .join(" | ");
        } catch {
          return JSON.stringify(answer);
        }
      }

      if (typeof answer === "string") return answer;

      if (answer && typeof answer === "object") {
        const textLike =
          answer.explanation ??
          answer.caption ??
          answer.text ??
          answer.response ??
          answer.answerText ??
          answer.notes ??
          null;

        if (typeof textLike === "string" && textLike.trim().length > 0) {
          return textLike;
        }

        try {
          return JSON.stringify(answer);
        } catch {
          return "[object]";
        }
      }

      if (answer != null) return String(answer);
      return "";
    })();

    // Submission object passed into aiScoring (for non-multi cases)
    const submissionForScoring = {
      answer,
      answerText,
    };

    let aiScore = null;
    let correct = null;
    let pointsEarned = 0;

    // ----------------------------
    // 1) Multi-question packs
    // ----------------------------
    if (isMultiPack && Array.isArray(task.items) && task.items.length > 0) {
      const items = task.items;
      const byId = new Map();
      items.forEach((it, i) => {
        const key = it.id != null ? String(it.id) : String(i);
        byId.set(key, { item: it, index: i });
      });

      let correctCount = 0;
      let evaluatedCount = 0;

      for (const entry of answer.answers) {
        if (!entry) continue;
        const rawId = entry.itemId != null ? String(entry.itemId) : null;
        const mapKey = rawId ?? String(evaluatedCount);
        const target = byId.get(mapKey);
        if (!target) {
          evaluatedCount += 1;
          continue;
        }

        const { item } = target;
        const givenValue = entry.value;
        const givenBaseIndex =
          typeof entry.baseIndex === "number" ? entry.baseIndex : null;

        let isCorrectItem = null;

        // Multi-choice items: compare index (preferred) or text
        if (answer.type === "multi-choice") {
          const itemCorrect = item.correctAnswer;
          const baseOptions = Array.isArray(item.options)
            ? item.options
            : Array.isArray(item.choices)
            ? item.choices
            : task.taskType === "true-false"
            ? ["True", "False"]
            : [];

          if (typeof itemCorrect === "number" && baseOptions.length > 0) {
            // compare indices
            if (
              givenBaseIndex != null &&
              givenBaseIndex >= 0 &&
              givenBaseIndex < baseOptions.length
            ) {
              isCorrectItem = givenBaseIndex === itemCorrect;
            } else if (givenValue != null) {
              const idxBase = baseOptions.findIndex(
                (opt) => String(opt).trim() === String(givenValue).trim()
              );
              isCorrectItem = idxBase === itemCorrect;
            }
          } else if (typeof itemCorrect === "string" && givenValue != null) {
            isCorrectItem =
              String(givenValue).trim().toLowerCase() ===
              itemCorrect.trim().toLowerCase();
          }
        }
        // Short-answer items: compare string to reference
        else if (answer.type === "multi-short") {
          const itemCorrect =
            typeof item.correctAnswer === "string"
              ? item.correctAnswer.trim()
              : null;
          if (itemCorrect && givenValue != null) {
            isCorrectItem =
              String(givenValue).trim().toLowerCase() ===
              itemCorrect.toLowerCase();
          }
        }

        if (isCorrectItem === true) {
          correctCount += 1;
        }
        evaluatedCount += 1;
      }

      const totalItems = items.length;
      const usedItems = evaluatedCount || totalItems;
      const fraction =
        usedItems > 0 ? Math.max(0, Math.min(1, correctCount / usedItems)) : 0;

      pointsEarned = Math.round(basePoints * fraction);

      // correct flag: only "true" if perfect, "false" if all wrong, null for partial
      if (fraction === 1) {
        correct = true;
      } else if (fraction === 0) {
        correct = false;
      } else {
        correct = null;
      }

      aiScore = {
        totalScore: pointsEarned,
        maxPoints: basePoints,
        correctCount,
        totalItems,
        evaluatedItems: usedItems,
        fractionCorrect: fraction,
        strategy: "rule-based-multi-item",
      };
    }

    // ----------------------------
    // 2) Non-multi tasks → AI / rule-based scoring core
    // ----------------------------
    if (!isMultiPack) {
      try {
        // Let the central AI/rule-based scorer decide how to grade this task.
        // For objective tasks this stays rule-based only; for PhotoJournal
        // and other subjective tasks this may call OpenAI.
        aiScore = await generateAIScore({
          task,
          rubric: task.aiRubric || null,
          submission: submissionForScoring,
        });
      } catch (e) {
        console.error("AI / rule-based scoring failed:", e);
      }

      const submittedAt = Date.now();

      const aiNumericScore =
        aiScore && typeof aiScore.score === "number"
          ? aiScore.score
          : aiScore && typeof aiScore.totalScore === "number"
          ? aiScore.totalScore
          : null;

      correct = (() => {
        // Prefer AI / central scorer when available (AI or rule-based)
        if (aiNumericScore != null) {
          return aiNumericScore > 0;
        }
        // Fallback: legacy behaviour for simple correctAnswer tasks
        if (task.correctAnswer == null) return null;
        return String(answer).trim() === String(task.correctAnswer).trim();
      })();

      // “Evidence tasks” are ones that don’t expect text and don’t have options,
      // e.g. photo, make-and-snap, body-break, etc.
      const isEvidenceTask =
        !!meta && meta.expectsText === false && meta.hasOptions === false;

      // Did the team actually submit *something*?
      const hasEvidence =
        answer != null &&
        (typeof answer === "string"
          ? answer.trim().length > 0
          : typeof answer === "object"
          ? Object.keys(answer).length > 0
          : true);

      // 🔹 Special: SORT tasks send a percentage score from the front-end
      if (
        task.taskType === "sort" &&
        answer &&
        typeof answer === "object" &&
        typeof answer.score === "number"
      ) {
        const pct = Math.max(0, Math.min(100, answer.score));
        pointsEarned = Math.round((pct / 100) * basePoints);
      } else if (aiNumericScore != null) {
        // Use the central scorer's numeric score (may be partial credit)
        pointsEarned = aiNumericScore;
      } else if (correct === true) {
        // Normal case: exact match says it's correct → full points
        pointsEarned = basePoints;
      } else if (correct === null && isEvidenceTask && hasEvidence) {
        // Evidence tasks with "something" submitted get full credit.
        pointsEarned = basePoints;
      } else {
        pointsEarned = 0;
      }

      // We'll use submittedAt again below, so keep it in scope:
      var submittedAtNonMulti = submittedAt;
    }

    // If we’re in the multi-pack path, we still need a timestamp
    const submittedAt = isMultiPack ? Date.now() : submittedAtNonMulti;

    // ==== Diff Detective race mechanics (first correct team wins bonus) ====
    if (
      task.taskType === "diff-detective" &&
      room.diffDetectiveRace &&
      room.diffDetectiveRace.taskIndex === idx &&
      room.diffDetectiveRace.active
    ) {
      const race = room.diffDetectiveRace;

      if (!race.completedTeams) {
        race.completedTeams = new Set();
      }

      if (!race.completedTeams.has(effectiveTeamId)) {
        race.completedTeams.add(effectiveTeamId);

        const timeFromStart =
          typeof race.startedAt === "number"
            ? submittedAt - race.startedAt
            : null;

        // First *correct* finisher becomes the winner
        if (correct === true && !race.winnerTeamId) {
          race.winnerTeamId = effectiveTeamId;

          const bonusPoints = 5; // tweak as you like

          // Add race bonus on top of normal points for this submission
          pointsEarned += bonusPoints;

          // Broadcast a winner event to teacher + all teams
          io.to(code).emit("diff-detective-race-winner", {
            roomCode: code,
            taskIndex: idx,
            teamId: effectiveTeamId,
            teamName,
            timeMs: timeFromStart,
            bonusPoints,
          });
        }

        // Optional: broadcast that this team has finished, even if not winner
        io.to(code).emit("diff-detective-race-finish", {
          roomCode: code,
          taskIndex: idx,
          teamId: effectiveTeamId,
          teamName,
          timeMs: timeFromStart,
          rank: race.completedTeams.size,
          correct,
        });
      }
    }

    room.submissions.push({
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      playerId: socket.data.playerId || null,
      taskIndex: idx,
      answer,
      correct,
      points: pointsEarned,
      aiScore,
      timeMs: timeMs ?? null,
      submittedAt,
    });

    // After every graded submission, advance THIS team to the next station so they must rescan.
    reassignStationForTeam(room, effectiveTeamId);

    // Maybe award a random treat for this submission
    const isQuick =
      !!room.taskset &&
      room.taskset.name === "Quick task" &&
      Array.isArray(room.taskset.tasks) &&
      room.taskset.tasks.length === 1;

    if (!isQuick) {
      maybeAwardTreat(code, room, effectiveTeamId);
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // Determine if this is a "quick taskset"
    const isQuickTaskset =
      !!room.taskset &&
      room.taskset.name === "Quick task" &&
      Array.isArray(room.taskset.tasks) &&
      room.taskset.tasks.length === 1;

    // Per-team progression
    if (room.taskset && Array.isArray(room.taskset.tasks)) {
      const currentIndex =
        typeof taskIndex === "number" && taskIndex >= 0
          ? taskIndex
          : typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : idx;

      const nextIndex = currentIndex + 1;

      if (isQuickTaskset) {
        // One-off quick task: let sendTaskToTeam handle "session complete".
        sendTaskToTeam(room, effectiveTeamId, nextIndex);
      } else {
        // For normal tasksets, remember the next index and let the
        // next colour scan trigger delivery of the new task.
        if (!room.teams[effectiveTeamId]) {
          room.teams[effectiveTeamId] = {};
        }
        room.teams[effectiveTeamId].nextTaskIndex = nextIndex;
      }
    }

    const submissionSummary = {
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      taskIndex: idx,
      answerText,
      correct,
      points: pointsEarned,
      timeMs: timeMs ?? null,
      submittedAt,
      aiScore, // <-- carries multi-pack or AI info, including PhotoJournal feedback
    };
    io.to(code).emit("taskSubmission", submissionSummary);

    socket.emit("task:received");
    if (typeof ack === "function") {
      ack({ ok: true });
    }

    // =======================================================
    // AUTO-ADVANCE: when ALL teams have submitted this task
    // =======================================================

    try {
      const totalTeams = Object.keys(room.teams || {}).length;

      const submittedTeams = new Set(
        room.submissions
          .filter(s => s.taskIndex === idx)
          .map(s => s.teamId)
      );

      const allSubmitted =
        totalTeams > 0 && submittedTeams.size >= totalTeams;

      if (allSubmitted) {
        scheduleNextTask({
          io,
          session: room,
          roomCode: code,
          reason: "all-teams-submitted",
          baseTaskIndex: idx,
        });
      }
    } catch (err) {
      console.error("Auto-advance scheduling failed:", err);
    }

  };

  socket.on("student:submitAnswer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });

  socket.on("task:requestNext", ({ roomCode, teamId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    const team = room.teams[teamId];
    if (!team) return;

    sendTaskToTeam(room, teamId, (team.taskIndex ?? -1) + 1);

  });

  socket.on("task:submit", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });

  // Backwards-compatible submit event names
  socket.on("submit:answer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });
  socket.on("submit-answer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });
// ------------------------------
  // Teacher load taskset + location selections
  // ------------------------------
  async function handleTeacherLoadTaskset(payload = {}) {
    try {
      const { roomCode, tasksetId, selectedRooms } = payload || {};
      const code = (roomCode || "").toUpperCase();

      if (!code || !tasksetId) {
        console.warn("handleTeacherLoadTaskset: missing roomCode or tasksetId");
        return;
      }

      const room = rooms[code];
      if (!room) {
        console.warn("handleTeacherLoadTaskset: room not found for", code);
        return;
      }

      // Multi-room scavenger hunt support
      if (Array.isArray(selectedRooms) && selectedRooms.length > 0) {
        room.selectedRooms = selectedRooms;
        console.log(
          `Room ${code} → Multi-room scavenger hunt:`,
          selectedRooms
        );
      } else {
        room.selectedRooms = null;
      }

      const tasksetDoc = await TaskSet.findById(tasksetId).lean();
      if (!tasksetDoc) {
        console.warn("handleTeacherLoadTaskset: TaskSet not found", tasksetId);
        socket.emit("taskset:error", { message: "Task Set not found" });
        return;
      }

      const tasks = Array.isArray(tasksetDoc.tasks) ? tasksetDoc.tasks : [];

      console.log(
        `handleTeacherLoadTaskset: loaded taskset ${tasksetId} for room ${code} with ${tasks.length} tasks`
      );

      // Attach full taskset to room
      room.taskset = {
        ...tasksetDoc,
        tasks,
      };
      room.taskIndex = -1;
      room.isActive = false;
      room.startedAt = null;

      // Let LiveSession & others refresh their state if needed
      const state = buildRoomState(room);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Notify the teacher client that the taskset is ready
      socket.emit("tasksetLoaded", {
        roomCode: code,
        tasksetId: String(tasksetDoc._id),
        name:
          tasksetDoc.name ||
          tasksetDoc.title ||
          tasksetDoc.tasksetName ||
          "Untitled set",
        numTasks: tasks.length,
        subject: tasksetDoc.subject || "",
        gradeLevel: tasksetDoc.gradeLevel || "",
      });
    } catch (err) {
      console.error("Error in handleTeacherLoadTaskset:", err);
      socket.emit("taskset:error", {
        message: "Failed to load task set.",
      });
    }
  }

  socket.on("teacher:loadTaskset", (payload) => {
    handleTeacherLoadTaskset(payload || {});
  });

  socket.on("loadTaskset", (payload) => {
    handleTeacherLoadTaskset(payload || {});
  });

  socket.on("teacher:startSession", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.startedAt = Date.now();
    room.isActive = true;
    room.taskIndex = -1;
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60;

    io.to(code).emit("session:started");
  });

  // OLD global next-task handler (kept as optional override button)
  function handleTeacherNextTask({ roomCode }) {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    room.taskIndex += 1;
    const index = room.taskIndex;

    if (index >= room.taskset.tasks.length) {
      io.to(code).emit("session:complete");
      return;
    }

    const task = room.taskset.tasks[index];

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    io.to(code).emit("task:launch", {
      index,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  }

  //socket.on("teacher:nextTask", (payload) => {
  //  handleTeacherNextTask(payload || {});
  //});

  // 🚨 IMPORTANT: shared helper to start a taskset for all teams
  function startTasksetForRoom(roomCode) {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];

    if (!room || !room.taskset) {
      console.warn("startTasksetForRoom: no room or taskset for", code);
      return;
    }

    const tasks = Array.isArray(room.taskset.tasks)
      ? room.taskset.tasks
      : [];

    if (tasks.length === 0) {
      console.warn("startTasksetForRoom: taskset has no tasks for", code);
      return;
    }

    room.isActive = true;
    room.startedAt = Date.now();
    // Keep-alive bump so late joiners still see/find this room for at least an hour.
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60;

    // Lightning round — only once per room
    if (!room.lightningInterval) {
      room.lightningInterval = setInterval(() => {
        const prompts = [
          "word about power",
          "animal that flies",
          "type of energy",
          "something that floats",
          "a loud sound",
          "a cold place",
          "a fast vehicle",
          "something green",
        ];
        const randomPrompt =
          prompts[Math.floor(Math.random() * prompts.length)];
        const randomTeam = getRandomTeam(code);

        io.to(code).emit("lightning-round", {
          prompt: randomPrompt,
          teamName: randomTeam?.teamName || "Someone",
        });
      }, 30000 + Math.random() * 10000); // 30–40 seconds
    }

    // Reset per-team progress
    Object.values(room.teams || {}).forEach((team) => {
      team.taskIndex = -1;
    });

    // Send task 0 to every joined team
    Object.keys(room.teams || {}).forEach((teamId) => {
      sendTaskToTeam(room, teamId, 0);
    });

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  }

  // Legacy entry point used by older clients
  socket.on("launchTaskset", ({ roomCode }) => {
    startTasksetForRoom(roomCode);
  });

  // Used by the new LiveSession green "Launch from taskset" button
  socket.on("teacher:launchNextTask", ({ roomCode }) => {
    startTasksetForRoom(roomCode);
  });

  // Quick ad-hoc task – one-off, BUT still uses an ephemeral taskset
  // so that handleStudentSubmit + scoring logic work.
  socket.on(
    "teacherLaunchTask",
    async (payload = {}) => {
      try {
        const { roomCode, task, prompt, correctAnswer, selectedRooms } = payload;
        const code = (roomCode || "").toUpperCase();
        if (!code) return;

        // Decide where the prompt is coming from
        const basePrompt =
          (task &&
            typeof task.prompt === "string" &&
            task.prompt.trim()) ||
          (typeof prompt === "string" && prompt.trim()) ||
          "";

        if (!basePrompt) return;

        let room = rooms[code];
        if (!room) {
          room = rooms[code] = await createRoom(code, socket.id);
        }

        // Preserve as much info as LiveSession gave us as possible
        const quickTask = {
          taskType: (task && task.taskType) || "short-answer",
          prompt: basePrompt,
          correctAnswer:
            (task && task.correctAnswer) ||
            (typeof correctAnswer === "string" ? correctAnswer : null),
          options:
            task &&
            Array.isArray(task.options) &&
            task.options.length > 0
              ? task.options
              : undefined,
          // NEW: carry multi-question pack items into the quick task
          items:
            task &&
            Array.isArray(task.items) &&
            task.items.length > 0
              ? task.items
              : undefined,
          // NEW: carry Brain Spark Notes bullets into quick task payload
          bullets:
            task &&
            Array.isArray(task.bullets) &&
            task.bullets.length > 0
              ? task.bullets
              : undefined,
          points:
            task && typeof task.points === "number" ? task.points : 10,
          subject: (task && task.subject) || "Ad-hoc",
          gradeLevel: (task && task.gradeLevel) || "",
          clue:
            task && typeof task.clue === "string" ? task.clue : undefined,
          timeLimitSeconds:
            task && typeof task.timeLimitSeconds === "number"
              ? task.timeLimitSeconds
              : 0,
          quickTask: true,
        };

        // Tiny, ephemeral taskset so AI scoring + analytics all work
        room.taskset = {
          name: "Quick task",
          subject: quickTask.subject,
          gradeLevel: quickTask.gradeLevel,
          tasks: [quickTask],
          isQuickTaskset: true,
        };

        // Leave room.taskIndex "out of the way" – student sends taskIndex=0
        room.taskIndex = -1;

        io.to(code).emit("task:launch", {
          index: 0,
          task: quickTask,
          timeLimitSeconds: quickTask.timeLimitSeconds || 0,
        });
      } catch (err) {
        console.error("Error in teacherLaunchTask:", err);
      }
    }
  );

  // --------------------------
  // Teacher: random treats config
  // --------------------------
  socket.on("teacher:updateTreatsConfig", (payload = {}) => {
    const { roomCode, enabled, totalTreats } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    ensureTreatsConfig(room);

    if (typeof enabled === "boolean") {
      room.treatsConfig.enabled = enabled;
    }
    if (typeof totalTreats === "number" && !Number.isNaN(totalTreats)) {
      const clean = Math.max(0, Math.floor(totalTreats));
      room.treatsConfig.total = clean;
      if (room.treatsConfig.given > clean) {
        room.treatsConfig.given = clean;
      }
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  });

  // --------------------------
  // Teacher: noise-control config
  // --------------------------
  socket.on("teacher:updateNoiseControl", (payload = {}) => {
    const { roomCode, enabled, threshold } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    ensureNoiseControl(room);

    if (typeof enabled === "boolean") {
      room.noiseControl.enabled = enabled;
    }
    if (typeof threshold === "number" && !Number.isNaN(threshold)) {
      room.noiseControl.threshold = Math.max(
        0,
        Math.min(100, Math.floor(threshold))
      );
    }

    updateNoiseDerivedState(code, room);
  });

  // --------------------------
  // Noise samples from student/teacher devices
  // --------------------------
  socket.on("noise:sample", (payload = {}) => {
    const { roomCode, level } = payload;
    const code = (roomCode || socket.data?.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    ensureNoiseControl(room);

    const numeric =
      typeof level === "number" ? level : Number(level) || 0;
    const clamped = Math.max(0, Math.min(100, numeric));

    if (typeof room.noiseLevel !== "number") {
      room.noiseLevel = clamped;
    } else {
      // Exponential moving average to smooth spikes
      room.noiseLevel = room.noiseLevel * 0.8 + clamped * 0.2;
    }

    updateNoiseDerivedState(code, room);
  });

  // Speed-draw race game
  socket.on("start-speed-draw", ({ roomCode, task }) => {
    raceWinner[roomCode] = null;
    io.to(roomCode).emit("speed-draw-question", task);
  });

  socket.on("speed-draw-answer", ({ roomCode, index, correct }) => {
    if (correct && !raceWinner[roomCode]) {
      raceWinner[roomCode] = socket.data.teamName;
      io.to(roomCode).emit("speed-draw-winner", {
        winner: socket.data.teamName,
      });
      updateTeamScore(roomCode, socket.data.teamId, 25);
    }
  });

  // Store per-team clues during session (global teamClues already declared)
  // Quick launch socket for generic tasks
  socket.on("start-task", ({ roomCode, taskId, taskType, taskData }) => {
    const session = getSessionByRoomCode(roomCode);
    if (!session) return;

    // Broadcast to all students in room
    io.to(roomCode).emit("new-task", {
      taskId,
      taskType,
      ...taskData,
    });

    console.log(`Task launched in ${roomCode}:`, taskType);
  });

  // Teacher ends session + email reports
  socket.on(
    "teacher:endSessionAndEmail",
    async ({
      roomCode,
      teacherEmail,
      assessmentCategories,
      includeIndividualReports,
      schoolName,
      perspectives,
    }) => {
      const code = (roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) {
        socket.emit("transcript:error", { message: "Room not found" });
        return;
      }

      const transcript = buildTranscript(room);
      const perParticipant = computePerParticipantStats(room, transcript);

      const summary = await generateSessionSummaries({
        roomCode: code,
        transcript,
        perParticipant,
        assessmentCategories,
        perspectives,
      });

      try {
        await sendTranscriptEmail({
          to: teacherEmail,
          roomCode: code,
          schoolName,
          summary,
          transcript,
          perParticipant,
          assessmentCategories,
          includeIndividualReports,
        });

        socket.emit("transcript:sent", {
          ok: true,
          email: teacherEmail,
        });
      } catch (e) {
        console.error("Transcript emailing failed:", e);
        socket.emit("transcript:error", {
          message: "Failed to send transcript email",
        });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────
  // Collaboration task: Random pairing + bonus for quality replies
  // Current team model: room.teams = { [teamId]: { teamName, members, ... } }
  // Uses teamId socket rooms (socket.join(teamId) already happens on join)
  // ──────────────────────────────────────────────────────────────

  // In-room pairing store keyed by taskId (or "default")
  function getOrCreateCollabState(room, taskId = "default") {
    if (!room._collab) room._collab = {};
    if (!room._collab[taskId]) {
      room._collab[taskId] = {
        // teamId -> partnerTeamId
        partnerByTeamId: {},
        // teamId -> mainAnswer
        mainByTeamId: {},
        createdAt: Date.now(),
      };
    }
    return room._collab[taskId];
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  socket.on("start-collaboration-task", ({ roomCode, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length < 2) {
      socket.emit("error", { message: "Need at least 2 teams for collaboration" });
      return;
    }

    const state = getOrCreateCollabState(room, taskId || "default");
    state.partnerByTeamId = {};
    state.mainByTeamId = {};

    const shuffled = shuffle(teamIds);

    // Pair adjacent; if odd, last pairs with first
    for (let i = 0; i < shuffled.length; i += 2) {
      const a = shuffled[i];
      const b = shuffled[i + 1] || shuffled[0];
      state.partnerByTeamId[a] = b;
      state.partnerByTeamId[b] = a;
    }

    // Notify each team of partner (emit to teamId room)
    for (const teamId of teamIds) {
      const partnerId = state.partnerByTeamId[teamId];
      const partnerName =
        room.teams?.[partnerId]?.teamName || `Team-${String(partnerId).slice(-4)}`;

      io.to(teamId).emit("collaboration-paired", {
        taskId,
        partnerTeamId: partnerId,
        partnerTeam: partnerName,
      });
    }

    // Refresh teacher state view (optional)
    const rs = buildRoomState(room);
    io.to(code).emit("room:state", rs);
    io.to(code).emit("roomState", rs);
  });

  socket.on("collaboration-main-submit", ({ roomCode, taskId, teamId, mainAnswer }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const myTeamId = teamId || socket.data?.teamId;
    if (!myTeamId || !room.teams?.[myTeamId]) return;

    const state = getOrCreateCollabState(room, taskId || "default");
    const partnerId = state.partnerByTeamId?.[myTeamId] || null;

    state.mainByTeamId[myTeamId] = typeof mainAnswer === "string" ? mainAnswer : "";

    // Send main answer to partner (if paired)
    if (partnerId && room.teams?.[partnerId]) {
      const myName = room.teams?.[myTeamId]?.teamName || `Team-${String(myTeamId).slice(-4)}`;
      io.to(partnerId).emit("collaboration-partner-answer", {
        taskId,
        partnerTeamId: myTeamId,
        partnerName: myName,
        partnerAnswer: mainAnswer,
      });
    }

    // If you later want to store these as submissions, do it here.
  });

  socket.on("collaboration-reply", async ({ roomCode, taskId, teamId, reply }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const myTeamId = teamId || socket.data?.teamId;
    if (!myTeamId || !room.teams?.[myTeamId]) return;

    const text = typeof reply === "string" ? reply.trim() : "";
    if (!text) return;

    // AI score 0–5 for reply quality
    let bonus = null;
    try {
      bonus = await generateAIScore({
        task: {
          taskType: "collaboration-bonus",
          prompt: "Score this peer reply 0-5: thoughtful, specific, kind, and helpful.",
          points: 5,
        },
        rubric: {
          totalPoints: 5,
          criteria: [
            {
              id: "quality",
              label: "Reply quality",
              maxPoints: 5,
              description: "Reward replies that are thoughtful, specific, kind, and helpful to their partner.",
            },
          ],
        },
        submission: { answerText: text },
      });
    } catch (e) {
      console.warn("collaboration-reply AI scoring failed:", e);
    }

    const bonusPoints =
      (bonus && typeof bonus.score === "number"
        ? bonus.score
        : typeof bonus?.totalScore === "number"
        ? bonus.totalScore
        : 0) || 0;

    // Award the AI-derived bonus points (0–5)
    if (bonusPoints > 0) updateTeamScore(room, myTeamId, bonusPoints);

    // Tell the replying team their bonus
    io.to(myTeamId).emit("collaboration-bonus", {
      taskId,
      bonus: bonusPoints,
    });

    // Optional: refresh room state for teacher dashboards
    const rs = buildRoomState(room);
    io.to(code).emit("room:state", rs);
    io.to(code).emit("roomState", rs);
  });

  // ─────────────────────────────────────────────
  // Mystery Clue Cards — Memory Bonus (teamId-based)
  // ─────────────────────────────────────────────
  socket.on("mystery-clues-start", ({ roomCode, taskId, teamId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const tid = teamId || socket.data?.teamId;
    if (!tid) return;

    if (taskId && !String(taskId).includes("final")) {
      const clues = ["Apple", "Cat", "Rocket", "Pizza", "Ghost", "Lightning"]
        .sort(() => Math.random() - 0.5)
        .slice(0, 2 + Math.floor(Math.random() * 2)); // 2–3 clues

      teamClues.set(tid, clues);

      io.to(tid).emit("mystery-clues-reveal", {
        taskId,
        clues,
        duration: 8000,
      });
    }
  });

  socket.on("start-final-mystery-challenge", ({ roomCode, teamId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    // If teacher triggers this, broadcast to everyone with per-team clueCount
    const teamIds = Object.keys(room.teams || {});
    for (const tid of teamIds) {
      const clueCount = teamClues.get(tid)?.length || 3;
      io.to(tid).emit("mystery-clues-final", {
        type: "mystery-clues",
        isFinal: true,
        clueCount,
      });
    }
  });

  socket.on("mystery-clues-submit", ({ roomCode, teamId, selected }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const tid = teamId || socket.data?.teamId;
    if (!tid) return;

    const correctClues = teamClues.get(tid) || [];
    const isPerfect = arraysDeepEqual(
      [...(selected || [])].sort(),
      [...correctClues].sort()
    );

    if (isPerfect) {
      updateTeamScore(room, tid, 10);
      io.to(tid).emit("bonus-awarded", {
        points: 10,
        reason: "Perfect Memory!",
      });
    }

    io.to(tid).emit("mystery-clues-result", { correct: isPerfect });

    const rs = buildRoomState(room);
    io.to(code).emit("room:state", rs);
    io.to(code).emit("roomState", rs);
  });

  // ─────────────────────────────────────────────
  // True/False Tic-Tac-Toe (teamId-based game state)
  // ─────────────────────────────────────────────
  function getOrCreateTicTacToe(room, key = "default") {
    if (!room._tictactoe) room._tictactoe = {};
    if (!room._tictactoe[key]) {
      room._tictactoe[key] = {
        board: Array(9).fill(null),
        roles: { X: null, O: null }, // role -> teamId
        createdAt: Date.now(),
        key,
      };
    }
    return room._tictactoe[key];
  }

  socket.on("start-true-false-tictactoe", ({ roomCode, task, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length < 2) return;

    const [a, b] = shuffle(teamIds).slice(0, 2);
    const statements = task?.statements || [];

    const key = taskId || "default";
    const state = getOrCreateTicTacToe(room, key);
    state.board = Array(9).fill(null);
    state.roles = { X: a, O: b };

    const aName = room.teams[a]?.teamName || `Team-${String(a).slice(-4)}`;
    const bName = room.teams[b]?.teamName || `Team-${String(b).slice(-4)}`;

    io.to(a).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      taskId: key,
      teamRole: "X",
      opponent: bName,
      statements,
      board: state.board,
    });

    io.to(b).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      taskId: key,
      teamRole: "O",
      opponent: aName,
      statements,
      board: state.board,
    });
  });

  socket.on("tictactoe-move", ({ roomCode, taskId, index, teamRole }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const key = taskId || "default";
    const state = getOrCreateTicTacToe(room, key);

    const idx = typeof index === "number" ? index : -1;
    if (idx < 0 || idx >= 9) return;

    // Update board server-side (prevents weird overwrites)
    if (state.board[idx] == null) state.board[idx] = teamRole;

    io.to(code).emit("tictactoe-update", {
      taskId: key,
      index: idx,
      symbol: teamRole,
      board: state.board,
    });
  });

  socket.on("tictactoe-winner", ({ roomCode, taskId, winnerRole }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const key = taskId || "default";
    const state = getOrCreateTicTacToe(room, key);

    const winnerTeamId = state.roles?.[winnerRole] || null;
    if (winnerTeamId && room.teams?.[winnerTeamId]) {
      updateTeamScore(room, winnerTeamId, 10);
      const winnerName =
        room.teams[winnerTeamId]?.teamName || `Team-${String(winnerTeamId).slice(-4)}`;

      io.to(code).emit("bonus-awarded", {
        teamId: winnerTeamId,
        team: winnerName,
        points: 10,
        reason: "Tic-Tac-Toe Win!",
      });

      const rs = buildRoomState(room);
      io.to(code).emit("room:state", rs);
      io.to(code).emit("roomState", rs);
    }
  });

  // HANGMAN DUEL SOCKET HANDLERS
  // All state is stored in room.hangman = { ... }

  socket.on('hangman-place-letter', (data) => {
    const { roomCode, teamId, letter, blankIndex } = data;
    const room = rooms[roomCode];
    if (!room || !room.hangman || !room.teams[teamId]) return;

    const hangman = room.hangman;

    // Validate it's this team's turn
    if (hangman.currentTurn !== room.teams[teamId].playerNumber) {
      socket.emit('turn-error', { message: "It's not your turn!" });
      return;
    }

    const wordLetter = hangman.word[blankIndex].toUpperCase();
    const guessedLetter = letter.toUpperCase();

    let isCorrect = false;
    let pointsAwarded = 0;

    if (guessedLetter === wordLetter && hangman.blanks[blankIndex] === null) {
      // Correct guess
      hangman.blanks[blankIndex] = guessedLetter;
      isCorrect = true;
      pointsAwarded = 10; // Base points for correct letter
      room.teams[teamId].score = (room.teams[teamId].score || 0) + pointsAwarded;
    } else if (!hangman.usedLetters.includes(guessedLetter)) {
      // Wrong guess (only penalize if new wrong letter)
      hangman.usedLetters.push(guessedLetter);
      hangman.wrongGuesses++;
      pointsAwarded = 0;
    } else {
      // Already guessed — no change
      pointsAwarded = 0;
    }

    // Check for win
    const wordComplete = hangman.blanks.every(l => l !== null);
    const gameOver = wordComplete || hangman.wrongGuesses >= 6;

    if (gameOver) {
      hangman.gameOver = true;
      hangman.winner = wordComplete ? teamId : null;
    } else {
      // Advance turn
      hangman.currentTurn = (hangman.currentTurn % hangman.playerCount) + 1;
    }

    // Emit update to all in room
    io.to(roomCode).emit('hangman-update', {
      blanks: hangman.blanks,
      wrongGuesses: hangman.wrongGuesses,
      usedLetters: hangman.usedLetters,
      currentTurn: hangman.currentTurn,
      gameOver: hangman.gameOver,
      winner: hangman.winner,
      scores: Object.fromEntries(
        Object.entries(room.teams).map(([id, t]) => [id, t.score || 0])
      ),
    });

    // Optional: individual feedback
    socket.emit('submission-result', {
      correct: isCorrect,
      points: pointsAwarded,
      message: isCorrect ? "Correct!" : "Wrong guess",
    });
  });

  socket.on('hangman-guess-word', (data) => {
    const { roomCode, teamId, guess } = data;
    const room = rooms[roomCode];
    if (!room || !room.hangman || !room.teams[teamId]) return;

    const hangman = room.hangman;
    const correct = guess.trim().toUpperCase() === hangman.word.toUpperCase();

    if (correct) {
      // Winner!
      hangman.gameOver = true;
      hangman.winner = teamId;
      room.teams[teamId].score = (room.teams[teamId].score || 0) + 50; // Big bonus
    } else {
      // Eliminated
      hangman.eliminated = hangman.eliminated || [];
      hangman.eliminated.push(room.teams[teamId].playerNumber);
    }

    // Advance turn or end game
    if (!hangman.gameOver) {
      hangman.currentTurn = (hangman.currentTurn % hangman.playerCount) + 1;
    }

    io.to(roomCode).emit('hangman-update', {
      blanks: hangman.blanks,
      wrongGuesses: hangman.wrongGuesses,
      currentTurn: hangman.currentTurn,
      gameOver: hangman.gameOver,
      winner: hangman.winner,
      eliminated: hangman.eliminated,
      scores: Object.fromEntries(
        Object.entries(room.teams).map(([id, t]) => [id, t.score || 0])
      ),
    });

    socket.emit('submission-result', {
      correct,
      points: correct ? 50 : 0,
      message: correct ? "You WIN!" : "Wrong guess — eliminated!",
    });
  });

  // Optional: Initialize hangman when task starts
  socket.on('hangman-init', (data) => {
    const { roomCode, task } = data;
    const room = rooms[roomCode];
    if (!room) return;

    const playerCount = Object.keys(room.teams).length;
    const lettersPerPlayer = Math.ceil(26 / playerCount);
    const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const playerLetters = {};

    Object.keys(room.teams).forEach((tid, idx) => {
      const start = idx * lettersPerPlayer;
      playerLetters[tid] = allLetters.slice(start, start + lettersPerPlayer);
      room.teams[tid].playerNumber = idx + 1;
      room.teams[tid].score = 0;
    });

    room.hangman = {
      word: task.word.toUpperCase(),
      blanks: Array(task.word.length).fill(null),
      wrongGuesses: 0,
      usedLetters: [],
      currentTurn: 1,
      playerCount,
      playerLetters,
      eliminated: [],
      gameOver: false,
      winner: null,
    };

    io.to(roomCode).emit('hangman-update', {
      blanks: room.hangman.blanks,
      wrongGuesses: 0,
      currentTurn: 1,
      playerCount,
      playerLetters: room.hangman.playerLetters,
      scores: Object.fromEntries(
        Object.entries(room.teams).map(([id, t]) => [id, 0])
      ),
    });
  });

  // ─────────────────────────────────────────────
  // Live debate (teamId-based)
  // ─────────────────────────────────────────────
  socket.on("start-live-debate", ({ roomCode, postulate, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length === 0) return;

    const half = Math.ceil(teamIds.length / 2);
    const ordered = shuffle(teamIds);

    ordered.forEach((teamId, i) => {
      const side = i < half ? "for" : "against";
      const team = room.teams[teamId];
      io.to(teamId).emit("debate-start", {
        type: "live-debate",
        taskId: taskId || "default",
        postulate,
        mySide: side,
        myTeamId: teamId,
        myTeamName: team?.teamName || `Team-${String(teamId).slice(-4)}`,
        teamMembers: Array.isArray(team?.members) && team.members.length > 0
          ? team.members
          : ["Member 1", "Member 2", "Member 3"],
        responses: [],
      });
    });
  });

  socket.on("debate-response", async (data = {}) => {
    const code = (data.roomCode || "").toUpperCase();
    if (!code) return;

    // broadcast to whole room; clients can filter by taskId if needed
    io.to(code).emit("debate-new-response", data);
    // Future: when all teams have 3 responses → judge via AI
  });
  // ─────────────────────────────────────────────
  // Disconnect / offline cleanup (team sockets)
  // Add this AFTER debate-response (or near the bottom of connection handler)
  // ─────────────────────────────────────────────
  socket.on("disconnect", async (reason) => {
    try {
      const code = (socket.data?.roomCode || "").toUpperCase();
      const teamId = socket.data?.teamId;

      // If this socket wasn't a team, ignore
      if (!code || !teamId) return;

      const room = rooms[code];
      if (!room || !room.teams?.[teamId]) return;

      const team = room.teams[teamId];

      // Mark offline (soft) immediately
      team.status = "offline";
      team.lastSeenAt = new Date();
      team.connected = false;

      // Persist offline state (best effort)
      try {
        const dbTeam = await TeamSession.findById(teamId);
        if (dbTeam) {
          dbTeam.status = "offline";
          dbTeam.lastSeenAt = new Date();
          await dbTeam.save();
        }
      } catch (e) {
        console.warn("disconnect: DB update failed:", e);
      }

      // Notify teacher + room UIs right away
      io.to(code).emit("team:offline", {
        teamId,
        teamName: team.teamName || `Team-${String(teamId).slice(-4)}`,
        reason,
      });

      const stateNow = buildRoomState(room);
      io.to(code).emit("room:state", stateNow);
      io.to(code).emit("roomState", stateNow);

      // If already scheduled, don't double-schedule
      if (team.offlineTimeout) clearTimeout(team.offlineTimeout);

      // Schedule hard cleanup (remove team) after OFFLINE_TIMEOUT_MS
      team.offlineTimeout = setTimeout(async () => {
        try {
          const r = rooms[code];
          if (!r?.teams?.[teamId]) return;

          const t = r.teams[teamId];

          // If they came back online, skip cleanup
          if (t.status === "online" || t.connected === true) return;

          // GOLD STANDARD: keep identity + DB record. Just mark stale/offline.
          t.status = "offline";
          t.connected = false;
          t.lastSeenAt = new Date();
          t.stale = true; // optional flag for UI/teacher

          // Optional: free station so the room doesn’t get “blocked” by offline teams
          const stationId = t.currentStationId;
          if (stationId && r.stations?.[stationId]?.assignedTeamId === teamId) {
            r.stations[stationId].assignedTeamId = null;
            // you may keep t.currentStationId as-is for continuity,
            // or clear it if you prefer forcing a fresh assignment on return:
            // t.currentStationId = null;
          }

          // Persist offline status (DO NOT DELETE)
          try {
            const dbTeam = await TeamSession.findById(teamId);
            if (dbTeam) {
              dbTeam.status = "offline";
              dbTeam.lastSeenAt = new Date();
              await dbTeam.save();
            }
          } catch (e) {
            console.warn("offline timeout: DB update failed:", e);
          }

          // Broadcast updated state
          const state = buildRoomState(r);
          io.to(code).emit("room:state", state);
          io.to(code).emit("roomState", state);

          io.to(code).emit("team:offline-timeout", {
            teamId,
            reason: "offline-timeout",
          });
        } catch (e) {
          console.error("offline timeout handler failed:", e);
        }
      }, OFFLINE_TIMEOUT_MS);
    } catch (err) {
      console.error("disconnect handler error:", err);
    }
  });
});

// ====================================================================
//  REST ROUTES – Profile, TaskSets, AI, Analytics
// ====================================================================

app.get("/db-check", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, db: "reachable" });
  } catch (err) {
    console.error("DB check failed:", err);
    res.status(500).json({ ok: false, error: "DB unreachable" });
  }
});

async function getOrCreateProfile() {
  let profile = await TeacherProfile.findOne();
  if (!profile) {
    profile = new TeacherProfile({});
    await profile.save();
  }
  return profile;
}

app.get("/api/profile/me", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    const plain = profile.toObject();

    // Ensure both fields are present for the frontend
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";

    res.json(plain);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    const plain = profile.toObject();

    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";

    res.json(plain);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.put("/api/profile/me", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();

    // Keep presenterTitle and title in sync
    const body = { ...req.body };

    if (body.presenterTitle && !body.title) {
      body.title = body.presenterTitle;
    }
    if (body.title && !body.presenterTitle) {
      body.presenterTitle = body.title;
    }

    Object.assign(profile, body);
    await profile.save();

    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";

    res.json(plain);
  } catch (err) {
    console.error("Profile update failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.put("/api/profile", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();

    const body = { ...req.body };
    if (body.presenterTitle && !body.title) {
      body.title = body.presenterTitle;
    }
    if (body.title && !body.presenterTitle) {
      body.presenterTitle = body.title;
    }

    Object.assign(profile, body);
    await profile.save();

    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";

    res.json(plain);
  } catch (err) {
    console.error("Profile update failed (/api/profile):", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.post("/api/tasksets", async (req, res) => {
  try {
    const t = new TaskSet(req.body);
    await t.save();
    res.status(201).json(t);
  } catch (err) {
    console.error("POST /api/tasksets error:", err);
    res.status(500).json({ error: "Failed to create task set" });
  }
});

// Verify TeacherApp entry code (auth required)
app.post("/api/teacher/verify-entry-code", authRequired, async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();

    if (!/^[a-z0-9]+$/i.test(code)) {
      return res.status(400).json({ ok: false, error: "Invalid code format" });
    }

    const profile = await TeacherProfile.findOne({ ownerId: req.userId }).lean();
    if (!profile) {
      return res.status(404).json({ ok: false, error: "Teacher profile not found" });
    }

    if (!profile.entryCode) {
      return res.status(403).json({ ok: false, error: "No entry code assigned" });
    }

    if (profile.entryCode !== code) {
      return res.status(401).json({ ok: false, error: "Incorrect code" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("verify-entry-code failed:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/tasksets", async (req, res) => {
  try {
    const sets = await TaskSet.find().sort({ createdAt: -1 }).lean();
    res.json(sets);
  } catch (err) {
    console.error("GET /api/tasksets error:", err);
    res.status(500).json({ error: "Failed to load task sets" });
  }
});

app.get("/api/tasksets/:id", async (req, res) => {
  try {
    const set = await TaskSet.findById(req.params.id).lean();
    if (!set) {
      return res.status(404).json({ error: "Task set not found" });
    }
    res.json(set);
  } catch (err) {
    console.error("GET /api/tasksets/:id error:", err);
    res.status(500).json({ error: "Failed to load task set" });
  }
});

app.put("/api/tasksets/:id", async (req, res) => {
  try {
    const updated = await TaskSet.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    }).lean();
    if (!updated) {
      return res.status(404).json({ error: "Task set not found" });
    }
    res.json(updated);
  } catch (err) {
    console.error("PUT /api/tasksets/:id error:", err);
    res.status(500).json({ error: "Failed to update task set" });
  }
});

app.delete("/api/tasksets/:id", async (req, res) => {
  try {
    await TaskSet.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasksets/:id error:", err);
    res.status(500).json({ error: "Failed to delete task set" });
  }
});

app.post("/api/ai/tasksets", generateAiTaskset);

// END SESSION — FINAL ANALYTICS SAVE
app.post("/api/sessions/:roomCode/end", authRequired, async (req, res) => {
  try {
    const { roomCode } = req.params;
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (room?.lightningInterval) {
      clearInterval(room.lightningInterval);
      room.lightningInterval = null;
      console.log("Cleared lightning interval for room", code);
    }

    const session = await Session.findOne({ roomCode: code });
    if (!session)
      return res.status(404).json({ error: "Session not found" });

    const leaderboard = session.teams.map((team) => ({
      teamName: team.name,
      score: team.score || 0,
      tasksCompleted: team.tasksCompleted || 0,
      avgResponseTime:
        team.tasksCompleted && team.totalResponseTime
          ? team.totalResponseTime / team.tasksCompleted
          : 0,
      perfectTasks: team.perfectTasks || 0,
    }));

    session.endedAt = new Date();
    session.leaderboard = leaderboard;
    session.totalTasks = session.tasks.length;
    session.completedTasks = session.teams.reduce(
      (sum, t) => sum + (t.tasksCompleted || 0),
      0
    );

    await session.save();

    io.to(code).emit("session-ended", { leaderboard });
    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error("End session error:", err);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Analytics API (protected)
app.get("/analytics/sessions", authRequired, listSessions);
app.get("/analytics/sessions/:id", authRequired, getSessionDetails);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
});