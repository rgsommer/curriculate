// ====================================================================
//  Curriculate Backend – Rooms, Teams, Stations, Tasks, AI, Emailing
// ====================================================================

import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import mongoose from "mongoose";
import bodyParser from "body-parser";

import TaskSet from "./models/TaskSet.js";
import TeacherProfile from "./models/TeacherProfile.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";

import { generateAIScore } from "./ai/aiScoring.js";
import { generateSessionSummaries } from "./ai/sessionSummaries.js";
import { sendTranscriptEmail } from "./email/transcriptEmailer.js";
import { generateTaskset as generateAiTaskset } from "./controllers/aiTasksetController.js";
import {
  listSessions,
  getSessionDetails,
} from "./controllers/analyticsController.js";
import authRoutes from "./routes/auth.js";
import { authRequired } from "./middleware/authRequired.js";
import { TASK_TYPE_META } from "../shared/taskTypes.js";

const app = express();
const server = http.createServer(app);

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
  cors: corsOptions,
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

function createRoom(roomCode, teacherSocketId, locationCode = "Classroom") {
  const stations = {};
  const NUM_STATIONS = 8;
  for (let i = 1; i <= NUM_STATIONS; i++) {
    const id = `station-${i}`;
    stations[id] = { id, assignedTeamId: null };
  }

  return {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
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
    noiseLevel: 0,        // smoothed noise measure (0–100)
    noiseBrightness: 1,   // 1 = full bright, ~0.3 = dim
  };
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

// Reassign only a single team's station
function reassignStationForTeam(room, teamId) {
  const stationIds = Object.keys(room.stations || {});
  if (stationIds.length === 0) return;
  const team = room.teams[teamId];
  if (!team) return;

  const current = team.currentStationId;
  let nextIndex = 0;
  if (current) {
    const idx = stationIds.indexOf(current);
    nextIndex = idx >= 0 ? (idx + 1) % stationIds.length : 0;
  }
  const nextStationId = stationIds[nextIndex];

  if (
    current &&
    room.stations[current] &&
    room.stations[current].assignedTeamId === teamId
  ) {
    room.stations[current].assignedTeamId = null;
  }

  team.currentStationId = nextStationId;
  team.lastScannedStationId = null;

  if (!room.stations[nextStationId]) {
    room.stations[nextStationId] = { id: nextStationId, assignedTeamId: null };
  }
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
    };
  }

  const stationsArray = Object.values(room.stations || {});

  // 🔁 Build scores from submissions, not team.score
  const scores = {};
  for (const sub of room.submissions || []) {
    if (!scores[sub.teamId]) scores[sub.teamId] = 0;
    scores[sub.teamId] += sub.points ?? 0;
  }

  // Derive an "overall" taskIndex for display...
  let overallTaskIndex =
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

  const treatsConfig = room.treatsConfig || {
    enabled: true,
    total: 4,
    given: 0,
  };

  const noiseControl = room.noiseControl || { enabled: false, threshold: 0 };

  return {
    code: room.code,
    locationCode: room.locationCode || "Classroom",
    teams: room.teams || {},
    stations: stationsArray,
    scores,
    taskIndex: overallTaskIndex,
    startedAt: room.startedAt || null,
    isActive: !!room.isActive,

    // Random treats (for LiveSession UI)
    treatsConfig: {
      enabled: !!treatsConfig.enabled,
      total:
        typeof treatsConfig.total === "number" && !Number.isNaN(treatsConfig.total)
          ? treatsConfig.total
          : 4,
      given:
        typeof treatsConfig.given === "number" && !Number.isNaN(treatsConfig.given)
          ? treatsConfig.given
          : 0,
    },
    pendingTreatTeams: Object.keys(room.pendingTreats || {}),

    // Noise-control state (for LiveSession + StudentApp)
    noise: {
      enabled: !!noiseControl.enabled && (noiseControl.threshold || 0) > 0,
      threshold:
        typeof noiseControl.threshold === "number" && !Number.isNaN(noiseControl.threshold)
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
  };
}

function sendTaskToTeam(room, teamId, index) {
  if (!room || !room.taskset) return;
  if (!room.teams || !room.teams[teamId]) return;

  const tasks = room.taskset.tasks || [];

  // If they've finished all tasks, mark complete for this team only
  if (index >= tasks.length) {
    room.teams[teamId].taskIndex = tasks.length;
    io.to(teamId).emit("session:complete");
    return;
  }

  const task = tasks[index];
  room.teams[teamId].taskIndex = index;

  const timeLimitSeconds =
    typeof task.timeLimitSeconds === "number"
      ? task.timeLimitSeconds
      : typeof task.time_limit === "number"
      ? task.time_limit
      : null;

  io.to(teamId).emit("task:launch", {
    index,
    task,
    timeLimitSeconds,
  });
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
  // Scale chance by remaining treats; clamp to keep it reasonable.
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

function updateNoiseDerivedState(code, room) {
  ensureNoiseControl(room);
  const control = room.noiseControl;

  const enabled = !!control.enabled && (control.threshold || 0) > 0;
  const threshold =
    typeof control.threshold === "number" && !Number.isNaN(control.threshold)
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

// ====================================================================
//  SOCKET.IO – EVENT HANDLERS
// ====================================================================
io.on("connection", (socket) => {
  // Teacher creates room
  socket.on("teacher:createRoom", (payload = {}) => {
    const { roomCode, locationCode } = payload;
    const code = (roomCode || "").toUpperCase();
    let room = rooms[code];

    if (room) {
      room.teacherSocketId = socket.id;
      if (locationCode) {
        room.locationCode = locationCode;
      }
    } else {
      room = rooms[code] = createRoom(code, socket.id, locationCode);
    }

    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;

    const state = buildRoomState(room);
    socket.emit("room:created", { roomCode: code });
    socket.emit("room:state", state);
    socket.emit("roomState", state);
  });

  // Generic joinRoom for HostView / viewers
  socket.on("joinRoom", (payload = {}, ack) => {
    const { roomCode, role, name } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];

    if (!room) {
      const error = { ok: false, error: "Room not found" };
      if (typeof ack === "function") {
        ack(error);
      } else {
        socket.emit("join:error", { message: error.error });
      }
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = role || "viewer";
    socket.data.displayName = name || role || "Viewer";

    const state = buildRoomState(room);
    socket.emit("room:state", state);
    socket.emit("roomState", state);

    if (typeof ack === "function") {
      ack({ ok: true, roomState: state });
    }
  });

  async function handleTeacherLoadTaskset({ roomCode, tasksetId }) {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const taskset = await TaskSet.findById(tasksetId).lean();
    if (!taskset) {
      socket.emit("taskset:error", { message: "Task Set not found" });
      return;
    }

    room.taskset = taskset;
    room.taskIndex = -1;

    io.to(code).emit("tasksetLoaded", {
      tasksetId: String(taskset._id),
      name: taskset.name,
      numTasks: taskset.tasks.length,
      subject: taskset.subject,
      gradeLevel: taskset.gradeLevel,
    });
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

  socket.on("teacher:nextTask", (payload) => {
    handleTeacherNextTask(payload || {});
  });

  // 🚨 IMPORTANT: only ONE launchTaskset handler, using per-team progression
  socket.on("launchTaskset", ({ roomCode }) => {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    // Mark the session as active
    room.isActive = true;
    room.startedAt = Date.now();

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
  });

  // Quick ad-hoc task
  socket.on("teacherLaunchTask", ({ roomCode, prompt, correctAnswer }) => {
    const code = (roomCode || "").toUpperCase();
    if (!code || !prompt) return;

    let room = rooms[code];
    if (!room) {
      room = rooms[code] = createRoom(code, socket.id);
    }

    const task = {
      taskType: "short-answer",
      prompt,
      correctAnswer: correctAnswer || null,
      points: 10,
    };

    room.taskset = {
      name: "Quick task",
      subject: "Ad-hoc",
      gradeLevel: "",
      tasks: [task],
    };
    room.taskIndex = 0;

    io.to(code).emit("task:launch", {
      index: 0,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  });

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
    const code =
      (roomCode || socket.data?.roomCode || "").toUpperCase();
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

  // Student joins room
  socket.on("student:joinRoom", (payload, ack) => {
    const { roomCode, teamName, members } = payload || {};
    const code = (roomCode || "").toUpperCase();

    let room = rooms[code];
    if (!room) {
      room = rooms[code] = createRoom(code, null);
    }

    socket.join(code);
    socket.data.role = "student";
    socket.data.roomCode = code;

    const teamId = socket.id;
    socket.data.teamId = teamId;

    const cleanMembers =
      Array.isArray(members) && members.length > 0
        ? members.map((m) => String(m).trim()).filter(Boolean)
        : [];

    const displayName =
      teamName || cleanMembers[0] || `Team-${String(teamId).slice(-4)}`;

    // No more deleting other teams based on name match
    if (!room.teams[teamId]) {
      room.teams[teamId] = {
        teamId,
        teamName: displayName,
        members: cleanMembers,
        score: 0,
        stationColor: null,
        currentStationId: null,
        taskIndex: -1,
      };
    } else {
      room.teams[teamId].teamName = displayName;
      room.teams[teamId].members = cleanMembers;
    }

    if (!room.stations || Object.keys(room.stations).length === 0) {
      room.stations = {};
      const NUM_STATIONS = 8;
      for (let i = 1; i <= NUM_STATIONS; i++) {
        const id = `station-${i}`;
        room.stations[id] = { id, assignedTeamId: null };
      }
    }

    if (!room.teams[teamId].currentStationId) {
      const stationIds = Object.keys(room.stations);
      const taken = new Set(
        Object.values(room.teams)
          .map((t) => t.currentStationId)
          .filter(Boolean)
      );
      const available = stationIds.filter((id) => !taken.has(id));
      const assignedId = available[0] || stationIds[0] || null;

      room.teams[teamId].currentStationId = assignedId;
      if (assignedId && room.stations[assignedId]) {
        room.stations[assignedId].assignedTeamId = teamId;
      }
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    if (room.teacherSocketId) {
      io.to(room.teacherSocketId).emit("team:joined", {
        teamId,
        teamName: displayName,
        members: cleanMembers,
      });
    }

    if (typeof ack === "function") {
      ack({ ok: true, roomState: state, teamId });
    }
  });

  // Student scans station
  socket.on("station:scan", (payload, ack) => {
    const { roomCode, teamId, stationId } = payload || {};
    const code = (roomCode || "").toUpperCase();

    const room = rooms[code];
    if (!room) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Room not found" });
      }
      return;
    }

    const effectiveTeamId = teamId || socket.data.teamId || socket.id;
    const team = room.teams[effectiveTeamId];
    if (!team) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Team not found in room" });
      }
      return;
    }

    let raw = String(stationId || "").trim().toLowerCase();
    if (!raw) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "No station id" });
      }
      return;
    }
    if (!raw.startsWith("station-")) {
      raw = `station-${raw}`;
    }

    if (!room.stations[raw]) {
      if (typeof ack === "function") {
        ack({ ok: false, error: `Unknown station: ${raw}` });
      }
      return;
    }

    team.currentStationId = raw;
    team.lastScannedStationId = raw;
    room.stations[raw].assignedTeamId = effectiveTeamId;

    const ev = {
      roomCode: code,
      teamId: effectiveTeamId,
      teamName: team.teamName,
      stationId: raw,
      timestamp: Date.now(),
    };
    io.to(code).emit("scanEvent", ev);

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    if (typeof ack === "function") {
      ack({ ok: true });
    }
  });

  // Student submits answer – reassign only that team's station
  const handleStudentSubmit = async (payload, ack) => {
    const { roomCode, teamId, taskIndex, answer, timeMs } = payload || {};
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Room or taskset not found" });
      }
      return;
    }

    const effectiveTeamId = teamId || socket.data.teamId || socket.id;
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

    let aiScore = null;
    if (task.aiRubricId) {
      try {
        aiScore = await generateAIScore({
          rubricId: task.aiRubricId,
          prompt: task.prompt,
          answer,
        });
      } catch (e) {
        console.error("AI scoring failed:", e);
      }
    }

        const correct = (() => {
      if (aiScore && typeof aiScore.totalScore === "number") {
        return aiScore.totalScore > 0;
      }
      if (task.correctAnswer == null) return null;
      return String(answer).trim() === String(task.correctAnswer).trim();
    })();

    const submittedAt = Date.now();

    const basePoints = task.points ?? 10;

    // Look up the task meta so we can treat evidence tasks differently
    const meta = TASK_TYPE_META?.[task.taskType];

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

    let pointsEarned = 0;
    if (correct === true) {
      // Normal case: AI or exact match says it's correct → full points
      pointsEarned = basePoints;
    } else if (correct === null && isEvidenceTask && hasEvidence) {
      // No objective correctness (no AI / no correctAnswer),
      // but this is an evidence task and they submitted something:
      // assume good faith and award full points.
      pointsEarned = basePoints;
    } else {
      pointsEarned = 0;
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

    // 🚫 For full tasksets, advance each team to the next station.
    // ✅ For ad-hoc Quick Tasks, keep them at the same station
    //    so they are NOT prompted to rescan / recolour.
    const isQuickTaskset =
      room.taskset && room.taskset.name === "Quick task";

    if (!isQuickTaskset) {
      reassignStationForTeam(room, effectiveTeamId);
    }

    // Maybe award a random treat for this submission
    maybeAwardTreat(code, room, effectiveTeamId);

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // --------------------------------------------------------
    // Per-team progression: auto-advance THIS team only
    // --------------------------------------------------------
    if (room.taskset && Array.isArray(room.taskset.tasks)) {
      const currentIndex =
        typeof taskIndex === "number" && taskIndex >= 0
          ? taskIndex
          : typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : idx;

      const nextIndex = currentIndex + 1;
      sendTaskToTeam(room, effectiveTeamId, nextIndex);
    }

    const submissionSummary = {
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      taskIndex: idx,
      answerText: String(answer || ""),
      correct,
      points: pointsEarned,
      timeMs: timeMs ?? null,
      submittedAt,
    };
    io.to(code).emit("taskSubmission", submissionSummary);

    socket.emit("task:received");
    if (typeof ack === "function") {
      ack({ ok: true });
    }
  };

  socket.on("student:submitAnswer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });

  socket.on("task:submit", (payload) => {
    handleStudentSubmit(payload);
  });

  //Teacher skips task
  socket.on("teacher:skipNextTask", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    const tasks = room.taskset.tasks || [];

    // For each team, jump ahead by one task index
    Object.entries(room.teams || {}).forEach(([teamId, team]) => {
      const currentIndex =
        typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : -1;
      const nextIndex = currentIndex + 1;
      // sendTaskToTeam already handles ">= length" by emitting session:complete
      sendTaskToTeam(room, teamId, nextIndex);
    });

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
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
  // ──────────────────────────────────────────────────────────────

  // When teacher launches a collaboration task (from frontend)
  socket.on("start-collaboration-task", ({ roomCode, taskId }) => {
    // Get active teams (adjust to your Session/Team model)
    const session = getSessionByRoomCode(roomCode); // Implement: fetch from DB
    const teams = session.teams || []; // Assume teams array with id, socketId, name

    if (teams.length < 2) {
      socket.emit("error", { message: "Need at least 2 teams for collaboration" });
      return;
    }

    // Random pairing (shuffle and group into pairs)
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const pairs = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      pairs.push([shuffled[i], shuffled[i + 1] || shuffled[0]]); // Odd team pairs back to first
    }

    // Notify each team of their partner
    for (const [teamA, teamB] of pairs) {
      io.to(teamA.socketId).emit("collaboration-paired", {
        partnerTeam: teamB.name,
        taskId,
      });
      io.to(teamB.socketId).emit("collaboration-paired", {
        partnerTeam: teamA.name,
        taskId,
      });
    }
  });

  // When a team submits their main answer → send to partner
  socket.on("collaboration-main-submit", ({ roomCode, taskId, mainAnswer }) => {
    const session = getSessionByRoomCode(roomCode);
    const team = session.teams.find(t => t.socketId === socket.id);
    const partner = findPartnerForTeam(session, team.id); // Implement: get paired team

    io.to(partner.socketId).emit("collaboration-partner-answer", {
      partnerName: team.name,
      partnerAnswer: mainAnswer,
    });

    // Save main answer (adjust to your model)
    saveTeamSubmission(session, team.id, taskId, { main: mainAnswer });
  });

  // When a team submits their reply → AI score bonus + update score
  socket.on("collaboration-reply", async ({ roomCode, taskId, reply }) => {
    const session = getSessionByRoomCode(roomCode);
    const team = session.teams.find(t => t.socketId === socket.id);

    // AI score the reply (using your aiScoring.js)
    const bonus = await generateAIScore({
      task: { prompt: "Score this peer reply 0-5: thoughtful, specific, kind, and helpful." },
      rubric: { maxPoints: 5, criteria: [{ id: "quality", maxPoints: 5 }] },
      submission: { answerText: reply },
    });

    // Update score + save reply
    updateTeamScore(session, team.id, bonus.totalScore);
    saveTeamSubmission(session, team.id, taskId, { reply });

    socket.emit("collaboration-bonus", { bonus: bonus.totalScore });
  });

  socket.on("disconnect", () => {
    const code = socket.data?.roomCode;
    const teamId = socket.data?.teamId;
    if (!code || !teamId) return;

    const room = rooms[code];
    if (!room || !room.teams[teamId]) return;

    const team = room.teams[teamId];
    const stationId = team.currentStationId;

    if (
      stationId &&
      room.stations[stationId] &&
      room.stations[stationId].assignedTeamId === teamId
    ) {
      room.stations[stationId].assignedTeamId = null;
    }

    delete room.teams[teamId];
    if (room.pendingTreats && room.pendingTreats[teamId]) {
      delete room.pendingTreats[teamId];
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
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

app.post("/api/ai/tasksets", authRequired, generateAiTaskset);

// Analytics API (protected)
app.get("/analytics/sessions", authRequired, listSessions);
app.get("/analytics/sessions/:id", authRequired, getSessionDetails);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
});
