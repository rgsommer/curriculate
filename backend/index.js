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

// Station colours
const COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "teal", "pink"];

// Simple UUID generator
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const app = express();
const server = http.createServer(app);

//const raceWinner = {};
const teamClues = new Map(); // ← now global!

function getSessionByRoomCode(code) {
  return rooms[code.toUpperCase()];
}

function updateTeamScore(room, teamId, points) {
  if (room?.teams?.[teamId]) {
    room.teams[teamId].score = (room.teams[teamId].score || 0) + points;
  }
}

function getRandomTeam(roomCode) {
  const room = rooms[roomCode];
  const teams = Object.values(room?.teams || {});
  return teams.length > 0 ? teams[Math.floor(Math.random() * teams.length)] : { name: "Team" };
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
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// ====================================================================
//  SOCKET.IO
// ====================================================================
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman)
      if (!origin) return callback(null, true);

      const allowed = allowedOrigins;

      if (allowed.some(allowedOrigin => origin.startsWith(allowedOrigin)) || 
          origin.endsWith(".vercel.app")) {
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

  // Load existing teams from DB
  const existingTeams = await TeamSession.find({ roomCode });
  for (const t of existingTeams) {
    const teamId = t._id.toString();
    room.teams[teamId] = {
      teamId,
      teamName: t.teamName,
      members: t.playerNames,
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
  // Re-join room if possible
  socket.on("resume-session", (data) => {
    const { roomCode, teamId } = data;
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room || !room.teams[teamId]) {
      socket.emit("session-resume-failed");
      return;
    }

    const team = room.teams[teamId];
    team.members.push(socket.id);
    socket.teamId = teamId;
    socket.roomCode = code;
    socket.join(code);

    // Re-send assignment
    socket.emit("station-assigned", {
      stationId: team.station,
      color: COLORS[parseInt(team.station.split("-")[1]) - 1],
      location: team.location || "any",
    });

    // Re-send current task
    if (room.currentTaskIndex >= 0 && room.tasks?.[room.currentTaskIndex]) {
      socket.emit("task", room.tasks[room.currentTaskIndex]);
    }

    console.log(`Resumed team ${teamId} in ${code}`);
  });

  // Teacher creates room
  socket.on("join-room", (payload = {}, ack) => {
    console.log("Received join-room:", payload); // LOG

    const { roomCode, name, teamId: clientTeamId } = payload;
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      console.error("No room:", code); // LOG
      if (typeof ack === "function") {
        ack({ ok: false, error: "Room not found" });
      }
      return;
    }

    const teamId = clientTeamId || generateUUID();

    if (!room.teams[teamId]) {
      room.teams[teamId] = {
        name: name || `Team ${Object.keys(room.teams).length + 1}`,
        members: [],
        score: 0,
        currentTaskIndex: 0,
        station: null,
        location: "any",
        disconnectedAt: null,
      };
    }

    const team = room.teams[teamId];
    team.members.push(socket.id);
    team.disconnectedAt = null;

    socket.join(code);
    socket.teamId = teamId;
    socket.roomCode = code;

    // Random color
    const usedStations = Object.values(room.teams).map(t => t.station).filter(Boolean);
    const available = COLORS.filter((_, i) => !usedStations.includes(`station-${i + 1}`));
    const colorIndex = available.length > 0 ? COLORS.indexOf(available[Math.floor(Math.random() * available.length)]) : Math.floor(Math.random() * COLORS.length);
    team.station = `station-${colorIndex + 1}`;

    // Location assignment
    const currentTask = room.tasks?.[room.currentTaskIndex] || {};
    const enforceLocation = currentTask.enforceLocation || false;

    if (enforceLocation && room.selectedRooms && room.selectedRooms.length > 0) {
      const counts = {};
      Object.values(room.teams).forEach(t => {
        if (t.location && t.location !== "any") counts[t.location] = (counts[t.location] || 0) + 1;
      });
      const shuffled = [...room.selectedRooms].sort(() => Math.random() - 0.5);
      let chosen = shuffled[0];
      for (const loc of shuffled) {
        if (!counts[loc] || counts[loc] < (counts[chosen] || 0)) chosen = loc;
      }
      team.location = chosen;
    } else if (enforceLocation && currentTask.requiredLocation && currentTask.requiredLocation !== "any") {
      team.location = currentTask.requiredLocation;
    } else {
      team.location = "any";
    }

    // Safe ack back to client
    const response = { ok: true, teamId, stationId: team.station, color: COLORS[colorIndex], location: team.location };
    if (typeof ack === "function") {
      ack(response);
    }

    io.to(code).emit("team-update", {
      teamId,
      name: team.name,
      station: team.station,
      location: team.location,
      score: team.score,
    });
    console.log("Team update emitted for:", teamId); // LOG

    if (room.currentTaskIndex >= 0 && room.tasks[room.currentTaskIndex]) {
      socket.emit("task", room.tasks[room.currentTaskIndex]);
    }
  });

  socket.on("resume-session", (data) => {
    console.log("Resume session:", data); // LOG

    const { roomCode, teamId } = data;
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room || !room.teams[teamId]) {
      socket.emit("session-resume-failed");
      return;
    }

    const team = room.teams[teamId];
    team.members.push(socket.id);
    socket.teamId = teamId;
    socket.roomCode = code;
    socket.join(code);

    socket.emit("station-assigned", {
      stationId: team.station,
      color: COLORS[parseInt(team.station.split("-")[1]) - 1],
      location: team.location || "any",
    });

    if (room.currentTaskIndex >= 0 && room.tasks[room.currentTaskIndex]) {
      socket.emit("task", room.tasks[room.currentTaskIndex]);
    }

    io.to(code).emit("team-update", { teamId, ...team }); // Re-send to LiveSession
  });

  // Generic joinRoom for HostView / viewers
  socket.on("join-room", (payload = {}, ack) => {
  const { roomCode, role, name, teamId: clientTeamId } = payload;
  const code = roomCode?.toUpperCase();

  if (!code || !rooms[code]) {
    return ack({ success: false, message: "Invalid room code" });
  }

  const room = rooms[code];

  // Persistent teamId from localStorage (client sends it), fallback to new
  const teamId = clientTeamId || generateUUID();

  // Create team if first time
  if (!room.teams[teamId]) {
    room.teams[teamId] = {
      name: name || `Team ${Object.keys(room.teams).length + 1}`,
      role: role || "student",
      members: [],
      score: 0,
      currentTaskIndex: 0,
      station: null,
      location: "any",
      disconnectedAt: null,
    };
  }

  const team = room.teams[teamId];

  // Re-attach this socket
  team.members = team.members.filter(id => id !== socket.id);
  team.members.push(socket.id);
  team.disconnectedAt = null;

  socket.join(code);
  socket.teamId = teamId;
  socket.roomCode = code;

  // ——— RANDOM COLOUR ASSIGNMENT (never sequential) ———
  const usedStations = Object.values(room.teams)
    .map(t => t.station)
    .filter(Boolean);

  const available = COLORS.filter((_, i) => 
    !usedStations.includes(`station-${i + 1}`)
  );

  const colorIndex = available.length > 0
    ? COLORS.indexOf(available[Math.floor(Math.random() * available.length)])
    : Math.floor(Math.random() * COLORS.length);

  team.station = `station-${colorIndex + 1}`;

  // ——— LOCATION ASSIGNMENT (only for multi-room scavenger) ———
  const currentTask = room.tasks[room.currentTaskIndex];
  const enforceLocation = currentTask?.enforceLocation || false;

  if (enforceLocation && room.selectedRooms && room.selectedRooms.length > 0) {
    // Balanced random from teacher's selected rooms
    const counts = {};
    Object.values(room.teams).forEach(t => {
      if (t.location && t.location !== "any") {
        counts[t.location] = (counts[t.location] || 0) + 1;
      }
    });

    const shuffled = [...room.selectedRooms].sort(() => Math.random() - 0.5);
    let chosen = shuffled[0];
    for (const loc of shuffled) {
      if (!counts[loc] || counts[loc] < (counts[chosen] || 0)) {
        chosen = loc;
      }
    }
    team.location = chosen;
  } else if (enforceLocation && currentTask?.requiredLocation && currentTask.requiredLocation !== "any") {
    team.location = currentTask.requiredLocation;
  } else {
    team.location = "any";
  }

  // Respond to client
  ack({
    success: true,
    teamId,
    stationId: team.station,
    color: COLORS[colorIndex],
    location: team.location,
  });

  // Broadcast update
  io.to(code).emit("team-update", {
    teamId,
    name: team.name,
    station: team.station,
    location: team.location,
    score: team.score,
  });

  // If session already running, send current task
  if (room.currentTaskIndex >= 0 && room.tasks[room.currentTaskIndex]) {
    socket.emit("task", room.tasks[room.currentTaskIndex]);
  }
});

  async function handleTeacherLoadTaskset({ roomCode, tasksetId }) {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    
    if (!room) return;

    // ←←← ADD THESE LINES (the only change you need!)
    if (Array.isArray(payload.selectedRooms) && payload.selectedRooms.length > 0) {
      room.selectedRooms = payload.selectedRooms;
      console.log(`Room ${code} → Multi-room scavenger hunt:`, payload.selectedRooms);
    } else {
      room.selectedRooms = null;
    }
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

  // 🚨 IMPORTANT: shared helper to start a taskset for all teams
  function startTasksetForRoom(roomCode) {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    room.isActive = true;
    room.startedAt = Date.now();

    // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
    // START LIGHTNING ROUND — ONLY ONCE PER ROOM
    // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
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

  // Student joins room (NEW PERSISTENT VERSION)
  socket.on("student:join-room", async (payload, ack) => {
  try {
    const { roomCode, teamName, members } = payload || {};
    const code = (roomCode || "").toUpperCase();

    if (!code) {
      if (typeof ack === "function") {
        return ack({ ok: false, error: "Missing room code." });
      }
      return;
    }

    // Ensure we have a room
    let room = rooms[code];
    if (!room) {
      room = rooms[code] = await createRoom(code, null);
    }

    const cleanMembers =
      Array.isArray(members) && members.length > 0
        ? members
            .map((m) => String(m).trim())
            .filter(Boolean)
        : [];

    const displayName =
      (teamName && teamName.trim()) ||
      cleanMembers[0] ||
      `Team-${String(socket.id).slice(-4)}`;

    // Create persistent TeamSession in Mongo
    const teamDoc = await TeamSession.create({
      roomCode: code,
      teamName: displayName,
      playerNames: cleanMembers,
      status: "online",
      lastSeenAt: new Date(),
      teamColor: "unassigned", // ✅ satisfy required field
    });

    const teamId = teamDoc._id.toString();

    // Attach metadata to this socket
    socket.data.role = "student";
    socket.data.roomCode = code;
    socket.data.teamId = teamId;

    // Join both the room and a per-team room
    socket.join(code);
    socket.join(teamId);

    // Ensure in-memory room.teams exists
    if (!room.teams) room.teams = {};

    // Register / update team in room state
    room.teams[teamId] = {
      teamId,
      teamName: displayName,
      members: cleanMembers,
      score: 0,
      stationColor: null,
      currentStationId: null,
      taskIndex: -1,
      status: "online",
      lastSeenAt: new Date(),
    };

    // Ensure stations exist
    if (!room.stations || Object.keys(room.stations).length === 0) {
      room.stations = {};
      const NUM_STATIONS = 8;
      for (let i = 1; i <= NUM_STATIONS; i++) {
        const id = `station-${i}`;
        room.stations[id] = { id, assignedTeamId: null };
      }
    }

    // Auto-assign first available station
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

    // Broadcast new room state
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // Notify teacher (for join sound / banner)
    if (room.teacherSocketId) {
      io.to(room.teacherSocketId).emit("teamJoined", {
        teamId,
        teamName: displayName,
        members: cleanMembers,
        status: "online",
      });
    }

    // Ack to the student
    if (typeof ack === "function") {
      ack({
        ok: true,
        roomState: state,
        teamId,
        teamSessionId: teamId,
      });
    }
  } catch (err) {
    console.error("Error in student:join-room:", err);
    if (typeof ack === "function") {
      ack({ ok: false, error: "Server error while joining room." });
    }
  }
});

  // Resume team session
  socket.on("resume-team-session", async (data, ack) => {
  try {
    const { roomCode, teamSessionId } = data || {};
    const code = (roomCode || "").toUpperCase();

    if (!code || !teamSessionId) {
      return ack && ack({ success: false, error: "Missing data" });
    }

    const room = rooms[code];
    if (!room) {
      return ack && ack({ success: false, error: "Room not found" });
    }

    const team = await TeamSession.findById(teamSessionId);
    if (!team || team.roomCode !== code) {
      return ack && ack({ success: false, error: "Team not found" });
    }

    const liveSession = await Session.findOne({ roomCode: code });
    if (!liveSession || liveSession.status === "ended") {
      return ack && ack({ success: false, error: "Room ended" });
    }

    const teamId = team._id.toString();

    // Re-attach socket
    socket.data.teamId = teamId;
    socket.data.roomCode = code;
    socket.join(code);
    socket.join(teamId);

    // Update DB
    team.status = "online";
    team.lastSeenAt = new Date();
    await team.save();

    // Update in-memory
    if (!room.teams) room.teams = {};
    if (!room.teams[teamId]) {
      room.teams[teamId] = {
        teamId,
        teamName: team.teamName,
        members: team.playerNames,
        score: 0,
        stationColor: null,
        currentStationId: null,
        taskIndex: -1,
        status: "online",
        lastSeenAt: new Date(),
      };
    } else {
      room.teams[teamId].status = "online";
      room.teams[teamId].lastSeenAt = new Date();
    }

    // Cancel any pending offline timeout
    if (room.teams[teamId].offlineTimeout) {
      clearTimeout(room.teams[teamId].offlineTimeout);
      room.teams[teamId].offlineTimeout = null;
    }

    // Notify teacher + broadcast state
    io.to(code).emit("team-status-updated", {
      teamSessionId: teamId,
      status: "online",
    });

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    if (ack) {
      ack({
        success: true,
        teamId,
        roomState: state,
      });
    }
  } catch (err) {
    console.error("Error in resume-team-session:", err);
    if (ack) ack({ success: false, error: "Server error while resuming team." });
  }
});

  // Explicit leave
    socket.on("station:scan", (payload, ack) => {
    const { roomCode, teamId, stationId } = payload || {};
    const code = (roomCode || "").toUpperCase();

    if (!code || !teamId || !rooms[code] || !rooms[code].teams[teamId]) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Invalid session" });
      }
      return;
    }

    const room = rooms[code];
    const team = room.teams[teamId];
    const currentTask = room.tasks?.[room.currentTaskIndex] || {};

    // Parse scanned ID
    const parts = (stationId || "").split("-");
    const scannedStation = parts.slice(0, 2).join("-");
    const scannedLocation = parts.slice(2).join("-") || "any";

    // Check colour
    if (scannedStation !== team.station) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Wrong colour!" });
      }
      return;
    }

    // Check location
    const enforce = currentTask.enforceLocation || false;
    const required = currentTask.requiredLocation || "any";

    if (enforce && required !== "any" && scannedLocation !== required) {
      if (typeof ack === "function") {
        ack({ ok: false, error: `Wrong room! Go to: ${required.toUpperCase()}` });
      }
      return;
    }

    // Success
    if (typeof ack === "function") {
      ack({ ok: true, message: "Correct!" });
    }

    // Auto-complete if scan-and-confirm
    if (currentTask.taskType === "scan-and-confirm") {
      updateTeamScore(room, teamId, currentTask.points || 10);
      // your advance logic here
    }
  });

  // Student scans station
  socket.on("station:scan", (payload, ack) => {
  console.log("station:scan received:", payload); // ← ADD LOGGING
  const { roomCode, teamId, stationId } = payload || {};
  const code = (roomCode || "").toUpperCase();

  if (!code || !teamId || !rooms[code]?.teams[teamId]) {
    console.error("Invalid scan:", { code, teamId }); // ← ADD LOGGING
    if (typeof ack === "function") {
      ack({ ok: false, error: "Invalid session" });
    }
    return;
  }

  const room = rooms[code];
  const team = room.teams[teamId];
  const currentTask = room.tasks?.[room.currentTaskIndex] || {};

  // Parse
  const parts = (stationId || "").split("-");
  const scannedStation = parts.slice(0, 2).join("-");
  const scannedLocation = parts.slice(2).join("-") || "any";

  // Check colour
  if (scannedStation !== team.station) {
    if (typeof ack === "function") {
      ack({ ok: false, error: "Wrong colour!" });
    }
    return;
  }

  // Check location
  const enforce = currentTask.enforceLocation || false;
  const required = currentTask.requiredLocation || "any";

  if (enforce && required !== "any" && scannedLocation !== required) {
    if (typeof ack === "function") {
      ack({ ok: false, error: `Wrong room! Go to: ${required.toUpperCase()}` });
    }
    return;
  }

  // Success
  if (typeof ack === "function") {
    ack({ ok: true, message: "Correct!" });
  }

  // Auto-complete
  if (currentTask.taskType === "scan-and-confirm") {
    updateTeamScore(room, teamId, currentTask.points || 10);
    // advance logic
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
    
    // ✅ After every graded submission (quick or full taskset),
    //    advance THIS team to the next station so they must rescan.
    reassignStationForTeam(room, effectiveTeamId);

    // Maybe award a random treat for this submission
    maybeAwardTreat(code, room, effectiveTeamId);

        const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // --------------------------------------------------------
    // Per-team progression:
    //   • Quick task → send completion immediately.
    //   • Full taskset → store next index and wait for new station scan.
    // --------------------------------------------------------
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

  socket.on("task:requestNext", ({ roomCode, teamId }) => {
  const code = (roomCode || "").toUpperCase();
  const room = rooms[code];
  if (!room || !room.taskset) return;

  const team = room.teams[teamId];
  if (!team) return;

  const nextIndex = team.taskIndex;

  sendTaskToTeam(room, teamId, nextIndex);
});

  socket.on("task:submit", (payload) => {
    handleStudentSubmit(payload);
  });

  socket.on("start-speed-draw", ({ roomCode, task }) => {
    io.to(roomCode).emit("speed-draw-question", task);
  });

socket.on("speed-draw-answer", ({ roomCode, index, correct }) => {
  if (correct && !raceWinner[roomCode]) {
    raceWinner[roomCode] = socket.teamName;
    io.to(roomCode).emit("speed-draw-winner", { winner: socket.teamName });
    updateTeamScore(roomCode, socket.teamName, 25);
  }
});

// Store per-team clues during session
  const teamClues = new Map(); // teamId → [clue1, clue2, ...]

//Quick launch socket
socket.on("start-task", ({ roomCode, taskId, taskType, taskData }) => {
  const session = getSessionByRoomCode(roomCode);
  if (!session) return;

  // Broadcast to all students in room
  io.to(roomCode).emit("new-task", {
    taskId,
    taskType,
    ...taskData,
  });

  console.log(`Task launched in ${roomCode}:`, taskType)  ;
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

  socket.on("start-musical-chairs", ({ roomCode, task }) => {
    const session = getSessionByRoomCode(roomCode);
    let stationsLeft = session.teams.length;

    const runRound = () => {
      if (stationsLeft <= 1) {
        io.to(roomCode).emit("musical-chairs-end", { winner: session.teams[0]?.name });
        return;
      }

      const scanned = new Set();
      const timeout = setTimeout(() => {
        const notScanned = session.teams.filter(t => !scanned.has(t.id));
        const winner = notScanned.length > 0 ? notScanned[0] : session.teams[0];
        const loser = scanned.size > 0 ? session.teams.find(t => scanned.has(t.id)) : null;

        // Award +5 to last to scan (winner)
        if (winner) updateTeamScore(session, winner.id, 5);

        io.to(roomCode).emit("musical-chairs-result", {
          winnerTeam: winner?.name || "Unknown",
          eliminatedTeam: loser?.name,
          stationsLeft: --stationsLeft,
        });

        setTimeout(runRound, 4000);
      }, 15000); // 15s to scan

      socket.on("musical-chairs-scan", () => {
        const team = session.teams.find(t => t.socketId === socket.id);
        if (team && !scanned.has(team.id)) {
          scanned.add(team.id);
        }
      });
    };

    runRound();
  });

  // ————————————————————————————————
  // Mystery Clue Cards — Memory Bonus
  // ————————————————————————————————

  // When a mystery-clues task starts (non-final)
  socket.on("mystery-clues-start", ({ roomCode, taskId, teamId }) => {
    if (taskId && !taskId.includes("final")) {
      const clues = ["Apple", "Cat", "Rocket", "Pizza", "Ghost", "Lightning"]
        .sort(() => Math.random() - 0.5)
        .slice(0, 2 + Math.floor(Math.random() * 2)); // 2–3 clues

      teamClues.set(teamId, clues);

      socket.emit("mystery-clues-reveal", {
        taskId,
        clues,
        duration: 8000
      });
    }
  });

  // Final memory challenge at end of taskset
  socket.on("start-final-mystery-challenge", ({ roomCode }) => {
    // Send to all teams
    io.to(roomCode).emit("mystery-clues-final", {
      type: "mystery-clues",
      isFinal: true,
      clueCount: teamClues.get(socket.teamId)?.length || 3
    });
  });

  // Student submits their guess
  socket.on("mystery-clues-submit", ({ roomCode, selected }) => {
    const correctClues = teamClues.get(socket.teamId) || [];
    const isPerfect = arraysDeepEqual(selected.sort(), correctClues.sort());

    if (isPerfect) {
      updateTeamScore(socket.teamId, 10);
      socket.emit("bonus-awarded", { points: 10, reason: "Perfect Memory!" });
    }

    socket.emit("mystery-clues-result", { correct: isPerfect });
  });

    socket.on("start-true-false-tictactoe", ({ roomCode, task }) => {
    const session = getSessionByRoomCode(roomCode);
    const teams = session.teams.filter(t => t.active);
    if (teams.length < 2) return;

    // Randomly pair two teams
    const [teamA, teamB] = teams.sort(() => Math.random() - 0.5).slice(0, 2);

    // Generate 8 statements (4 true, 4 false)
    const statements = task.statements || generateTrueFalseStatements();

    io.to(teamA.socketId).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      teamRole: "X",
      opponent: teamB.name,
      statements,
      board: Array(9).fill(null)
    });

    io.to(teamB.socketId).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      teamRole: "O",
      opponent: teamA.name,
      statements,
      board: Array(9).fill(null)
    });
  });

  socket.on("tictactoe-move", ({ roomCode, index, teamRole }) => {
    // Broadcast move to both players
    io.to(roomCode).emit("tictactoe-update", { index, symbol: teamRole });
  });

  socket.on("tictactoe-winner", ({ roomCode, winnerRole }) => {
    const session = getSessionByRoomCode(roomCode);
    const winnerTeam = session.teams.find(t => t.role === winnerRole);
    if (winnerTeam) {
      updateTeamScore(session, winnerTeam.id, 10);
      io.to(roomCode).emit("bonus-awarded", { team: winnerTeam.name, points: 10 });
    }
  });

    socket.on("start-mad-dash-sequence", ({ roomCode }) => {
    const session = getSessionByRoomCode(roomCode);
    const colors = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange"];
    const length = 3 + Math.floor(Math.random() * 3); // 3–5
    const sequence = [];

    for (let i = 0; i < length; i++) {
      let color;
      do {
        color = colors[Math.floor(Math.random() * colors.length)];
      } while (color === session.teams.find(t => t.socketId === socket.id)?.color);
      sequence.push(color);
    }

    io.to(roomCode).emit("mad-dash-sequence-start", {
      type: "mad-dash-sequence",
      sequence,
    });

    const completed = new Set();

    socket.on("mad-dash-complete", () => {
      const team = session.teams.find(t => t.socketId === socket.id);
      if (team && !completed.has(team.id)) {
        completed.add(team.id);
        if (completed.size === 1) {
          updateTeamScore(session, team.id, 10);
          io.to(roomCode).emit("mad-dash-winner", { winnerTeam: team.name });
        }
      }
    });
  });

    socket.on("start-live-debate", ({ roomCode, postulate }) => {
    const session = getSessionByRoomCode(roomCode);
    const teams = session.teams;
    const half = Math.ceil(teams.length / 2);
    teams.forEach((t, i) => {
      const side = i < half ? "for" : "against";
      io.to(t.socketId).emit("debate-start", {
        type: "live-debate",
        postulate,
        mySide: side,
        myTeamName: t.name,
        teamMembers: t.members || ["Member 1", "Member 2", "Member 3"],
        responses: []
      });
    });
  });

  socket.on("debate-response", async (data) => {
    io.to(data.roomCode).emit("debate-new-response", data);
    // When all teams have 3 responses → judge
    // (Implement count check + call generateAIScore with rubric)
  });

  socket.on("disconnect", async () => {
    const code = socket.data?.roomCode;
    const teamId = socket.data?.teamId;
    if (!code || !teamId) return;

    const room = rooms[code];
    if (!room || !room.teams[teamId]) return;

    room.teams[teamId].status = "offline";
    room.teams[teamId].lastSeenAt = new Date();

    // Save to DB
    const dbTeam = await TeamSession.findById(teamId);
    if (dbTeam) {
      dbTeam.status = "offline";
      dbTeam.lastSeenAt = new Date();
      await dbTeam.save();
    }

    // Notify teacher
    io.to(code).emit("team-status-updated", {
      teamSessionId: teamId,
      status: "offline",
    });

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // Schedule auto-removal after timeout
    const timeoutId = setTimeout(async () => {
      try {
        const stillOffline = await TeamSession.findById(teamId);
        if (stillOffline && stillOffline.status === "offline") {
          await TeamSession.deleteOne({ _id: teamId });
          if (room.teams[teamId]) {
            delete room.teams[teamId];
          }
          io.to(code).emit("team-removed", { teamSessionId: teamId });

          const updatedState = buildRoomState(room);
          io.to(code).emit("room:state", updatedState);
          io.to(code).emit("roomState", updatedState);
        }
      } catch (err) {
        console.error("TTL cleanup error:", err);
      }
    }, OFFLINE_TIMEOUT_MS);

    // Store timeout for possible cancel on reconnect
    room.teams[teamId].offlineTimeout = timeoutId;
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
      console.log("Cleared lightning interval for room", code); // Optional debug
    }

    const session = await Session.findOne({ roomCode: code });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const leaderboard = session.teams.map(team => ({
      teamName: team.name,
      score: team.score || 0,
      tasksCompleted: team.tasksCompleted || 0,
      avgResponseTime: team.totalResponseTime / (team.tasksCompleted || 1),
      perfectTasks: team.perfectTasks || 0,
    }));

    session.endedAt = new Date();
    session.leaderboard = leaderboard;
    session.totalTasks = session.tasks.length;
    session.completedTasks = session.teams.reduce((sum, t) => sum + (t.tasksCompleted || 0), 0);

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