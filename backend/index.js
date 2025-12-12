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
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
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

  // Emit both event names for backward compatibility
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
  socket.on("teacher:createRoom", async ({ roomCode }) => {
    const code = roomCode?.toUpperCase();
    if (!code) return;

    if (rooms[code]) {
      // Room already exists — just attach teacher
      rooms[code].teacherSocketId = socket.id;
      socket.join(code);
      console.log(`Teacher re-joined existing room ${code}`);
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

      if (!room.teams) {
        room.teams = {};
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
      } else {
        room.teams[teamId].teamName = cleanName;
        room.teams[teamId].members = memberList;
        room.teams[teamId].status = "online";
      }

      // Cancel any offline cleanup timeout if it exists
      if (room.teams[teamId].offlineTimeout) {
        clearTimeout(room.teams[teamId].offlineTimeout);
        delete room.teams[teamId].offlineTimeout;
      }

      // 🔹 NEW: give this team a starting station so scanning is the first step
      if (room.stations && Object.keys(room.stations).length > 0) {
        reassignStationForTeam(room, teamId);
      }

      // Join socket rooms + tag socket
      socket.join(code);
      socket.join(teamId);
      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = cleanName;

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
      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = team.teamName;

      const state = buildRoomState(room);

      if (typeof ack === "function") {
        ack({
          success: true,
          teamId,
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
  const handleStationScan = (payload = {}, ack) => {
    console.log("station:scan received:", payload);

    const { roomCode, teamId, stationId, locationSlug } = payload || {};
    const code = (roomCode || "").toUpperCase();

    if (!code || !teamId || !rooms[code]?.teams?.[teamId]) {
      console.error("Invalid scan:", { code, teamId });
      if (typeof ack === "function") {
        ack({ ok: false, error: "Invalid session" });
      }
      return;
    }

    const room = rooms[code];
    const team = room.teams[teamId];

    // Helper: normalize a location slug (QR codes may include raw "214", "Classroom", etc.)
    const normLoc = (v) =>
      typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "-") : null;

    // Determine the "current task" (used to decide whether scans are enforced)
    let activeTask = room.currentTask || null;
    if (!activeTask && room.taskset && Array.isArray(room.taskset.tasks)) {
      const idx =
        typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : typeof room.taskIndex === "number" && room.taskIndex >= 0
          ? room.taskIndex
          : -1;
      activeTask = idx >= 0 ? room.taskset.tasks[idx] || null : null;
    }

    const cfg = activeTask?.config || {};
    const requireScan = cfg.stationBased === true && cfg.requireScan === true;

    // Only enforce location when this is a MULTI-ROOM activity
    const isMultiRoom =
      Array.isArray(room.selectedRooms) && room.selectedRooms.length > 1;

    // Determine expected station from either legacy `team.station` or new `team.currentStationId`
    const expectedStation = team.station || team.currentStationId;

    // Always enforce correct station colour when we have an expectedStation
    if (expectedStation) {
      const stationColourMap = {
        "station-1": "red",
        "station-2": "blue",
        "station-3": "green",
        "station-4": "yellow",
      };

      const parts = String(stationId || "").split("-");
      const scannedStation = parts.slice(0, 2).join("-");
      const scannedColour = stationColourMap[scannedStation] || null;

      const expectedRaw = String(expectedStation || "").toLowerCase().trim();
      const expectsStationId = expectedRaw.startsWith("station-");
      const expectsColour =
        expectedRaw === "red" ||
        expectedRaw === "blue" ||
        expectedRaw === "green" ||
        expectedRaw === "yellow";

      const stationOk = expectsStationId
        ? scannedStation === expectedRaw
        : expectsColour
        ? scannedColour === expectedRaw
        : scannedStation === expectedRaw;

      if (!stationOk) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Wrong station colour." });
        }
        return;
      }
    }

    // Enforce location ONLY for multi-room + scan-locked tasks
    if (requireScan && isMultiRoom) {
      const scannedLoc = normLoc(locationSlug);
      const expectedLoc = normLoc(team.locationSlug || room.locationCode);

      if (expectedLoc && scannedLoc && expectedLoc !== scannedLoc) {
        // If the colour is correct but location is wrong, guide them clearly.
        // (Matches your prior UX: “Go to LOCATION COLOUR”.)
        const stationColourMap = {
          "station-1": "RED",
          "station-2": "BLUE",
          "station-3": "GREEN",
          "station-4": "YELLOW",
        };
        const colourLabel = stationColourMap[expectedStation] || "your station";
        const locLabel = String(team.locationSlug || room.locationCode || expectedLoc);

        if (typeof ack === "function") {
          ack({ ok: false, error: `Wrong location. Go to ${locLabel} ${colourLabel}.` });
        }
        return;
      }
    }

    team.lastScannedStationId = expectedStation || stationId || null;

    // If this team has a "nextTaskIndex" queued (normal taskset flow), deliver that task now.
    if (room.taskset && Array.isArray(room.taskset.tasks)) {
      const queuedIndex =
        typeof team.nextTaskIndex === "number" && team.nextTaskIndex >= 0
          ? team.nextTaskIndex
          : -1;

      if (queuedIndex >= 0) {
        // sendTaskToTeam will also update team.taskIndex and handle "session complete"
        sendTaskToTeam(room, teamId, queuedIndex);
        // Clear the queue so we don't re-send on the next scan.
        delete team.nextTaskIndex;
      }
    }

    // Optional: special "scan-and-confirm" task type which awards points just for scanning the correct station.
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

    if (typeof ack === "function") {
      ack({ ok: true, message: "Correct station!" });
    }
  };

  socket.on("station:scan", handleStationScan);
  socket.on("station-scan", handleStationScan);

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
    io.to(roomCode).emit("speed-draw-question", task);
  });

  socket.on("speed-draw-answer", ({ roomCode, index, correct }) => {
    if (correct && !raceWinner[roomCode]) {
      raceWinner[roomCode] = socket.teamName;
      io.to(roomCode).emit("speed-draw-winner", {
        winner: socket.teamName,
      });
      updateTeamScore(roomCode, socket.teamName, 25);
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

  // Teacher skips task
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

  socket.on("start-collaboration-task", ({ roomCode, taskId }) => {
    const session = getSessionByRoomCode(roomCode);
    const teams = session?.teams || [];
    if (teams.length < 2) {
      socket.emit("error", {
        message: "Need at least 2 teams for collaboration",
      });
      return;
    }

    // Random pairing (shuffle and group into pairs)
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const pairs = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      pairs.push([shuffled[i], shuffled[i + 1] || shuffled[0]]);
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

  socket.on(
    "collaboration-main-submit",
    ({ roomCode, taskId, mainAnswer }) => {
      const session = getSessionByRoomCode(roomCode);
      const teams = session?.teams || [];
      const team = teams.find((t) => t.socketId === socket.id);
      if (!team) return;

      // TODO: implement findPartnerForTeam
      const partner = null;

      if (partner) {
        io.to(partner.socketId).emit("collaboration-partner-answer", {
          partnerName: team.name,
          partnerAnswer: mainAnswer,
        });
      }

      // Save main answer (adjust to your model)
      // saveTeamSubmission(session, team.id, taskId, { main: mainAnswer });
    }
  );

  socket.on("collaboration-reply", async ({ roomCode, taskId, reply }) => {
    const session = getSessionByRoomCode(roomCode);
    const teams = session?.teams || [];
    const team = teams.find((t) => t.socketId === socket.id);
    if (!team) return;

    const bonus = await generateAIScore({
      task: {
        taskType: "collaboration-bonus",
        prompt:
          "Score this peer reply 0-5: thoughtful, specific, kind, and helpful.",
        points: 5,
      },
      rubric: {
        totalPoints: 5,
        criteria: [
          {
            id: "quality",
            label: "Reply quality",
            maxPoints: 5,
            description:
              "Reward replies that are thoughtful, specific, kind, and helpful to their partner.",
          },
        ],
      },
      submission: { answerText: reply },
    });

    const bonusPoints =
      (bonus && typeof bonus.score === "number"
        ? bonus.score
        : typeof bonus?.totalScore === "number"
        ? bonus.totalScore
        : 0) || 0;

    updateTeamScore(session, team.id, bonusPoints);
    // saveTeamSubmission(session, team.id, taskId, { reply });

    socket.emit("collaboration-bonus", { bonus: bonusPoints });
  });

  // Mystery Clue Cards — Memory Bonus
  socket.on("mystery-clues-start", ({ roomCode, taskId, teamId }) => {
    if (taskId && !taskId.includes("final")) {
      const clues = ["Apple", "Cat", "Rocket", "Pizza", "Ghost", "Lightning"]
        .sort(() => Math.random() - 0.5)
        .slice(0, 2 + Math.floor(Math.random() * 2)); // 2–3 clues

      teamClues.set(teamId, clues);

      socket.emit("mystery-clues-reveal", {
        taskId,
        clues,
        duration: 8000,
      });
    }
  });

  socket.on("start-final-mystery-challenge", ({ roomCode }) => {
    io.to(roomCode).emit("mystery-clues-final", {
      type: "mystery-clues",
      isFinal: true,
      clueCount: teamClues.get(socket.teamId)?.length || 3,
    });
  });

  socket.on("mystery-clues-submit", ({ roomCode, selected }) => {
    const correctClues = teamClues.get(socket.teamId) || [];
    const isPerfect = arraysDeepEqual(
      [...selected].sort(),
      [...correctClues].sort()
    );

    if (isPerfect) {
      updateTeamScore(socket.teamId, 10);
      socket.emit("bonus-awarded", {
        points: 10,
        reason: "Perfect Memory!",
      });
    }

    socket.emit("mystery-clues-result", { correct: isPerfect });
  });

  // True/False Tic-Tac-Toe (experimental)
  socket.on("start-true-false-tictactoe", ({ roomCode, task }) => {
    const session = getSessionByRoomCode(roomCode);
    const teams = session?.teams?.filter((t) => t.active) || [];
    if (teams.length < 2) return;

    const [teamA, teamB] = teams.sort(() => Math.random() - 0.5).slice(0, 2);
    const statements = task.statements || []; // assume prepared

    io.to(teamA.socketId).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      teamRole: "X",
      opponent: teamB.name,
      statements,
      board: Array(9).fill(null),
    });

    io.to(teamB.socketId).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      teamRole: "O",
      opponent: teamA.name,
      statements,
      board: Array(9).fill(null),
    });
  });

  socket.on("tictactoe-move", ({ roomCode, index, teamRole }) => {
    io.to(roomCode).emit("tictactoe-update", { index, symbol: teamRole });
  });

  socket.on("tictactoe-winner", ({ roomCode, winnerRole }) => {
    const session = getSessionByRoomCode(roomCode);
    const winnerTeam = session?.teams?.find((t) => t.role === winnerRole);
    if (winnerTeam) {
      updateTeamScore(session, winnerTeam.id, 10);
      io.to(roomCode).emit("bonus-awarded", {
        team: winnerTeam.name,
        points: 10,
      });
    }
  });

  // ─────────────────────────────────────────────
  // Mad Dash Sequence – with countdown + winner
  // ─────────────────────────────────────────────
  socket.on("start-mad-dash-sequence", ({ roomCode, length = 4 } = {}) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const sequence = [];
    const safeLength = Math.max(3, Math.min(8, length));
    for (let i = 0; i < safeLength; i++) {
      sequence.push(COLORS[i % COLORS.length]);
    }

    room.madDashSequence = {
      active: true,
      sequence,
      startedAt: null,
      completedTeams: new Set(),
    };

    const COUNTDOWN_DURATION_MS = 4000;

    // 1) Tell students to show the "On your marks… 3, 2, 1, GO!" overlay
    io.to(code).emit("mad-dash-countdown", {
      mode: "mad-dash",
      durationMs: COUNTDOWN_DURATION_MS,
      sequenceLength: sequence.length,
    });

    // 2) After countdown, actually start the race + send the sequence
    setTimeout(() => {
      const currentRoom = rooms[code];
      if (!currentRoom || !currentRoom.madDashSequence?.active) return;

      const now = Date.now();
      currentRoom.madDashSequence.startedAt = now;

      io.to(code).emit("mad-dash-sequence-start", {
        type: "mad-dash-sequence",
        sequence,
        startedAt: now,
      });
    }, COUNTDOWN_DURATION_MS);
  });

  socket.on("mad-dash-complete", (payload = {}) => {
    const code = (payload.roomCode || socket.data?.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.madDashSequence || !room.madDashSequence.active) return;

    const teamId = payload.teamId || socket.data?.teamId;
    if (!teamId || !room.teams?.[teamId]) return;

    const state = room.madDashSequence;
    if (!state.completedTeams) {
      state.completedTeams = new Set();
    }

    if (state.completedTeams.has(teamId)) {
      return; // already finished
    }

    state.completedTeams.add(teamId);

    const team = room.teams[teamId];
    const teamName = team?.teamName || `Team-${String(teamId).slice(-4)}`;
    const timeMs =
      typeof state.startedAt === "number" ? Date.now() - state.startedAt : null;

    // First finisher earns bonus + winner banner
    if (state.completedTeams.size === 1) {
      const basePoints = 10;
      updateTeamScore(room, teamId, basePoints);

      io.to(code).emit("mad-dash-winner", {
        roomCode: code,
        teamId,
        teamName,
        timeMs,
        points: basePoints,
      });
    }

    // Notify that this team has finished (even if not first)
    io.to(code).emit("mad-dash-finish", {
      roomCode: code,
      teamId,
      teamName,
      timeMs,
      rank: state.completedTeams.size,
    });
  });

  // ─────────────────────────────────────────────
  // Flashcards Race – multi-round shout-to-answer game
  // ─────────────────────────────────────────────

  // Teacher moves to the next card in the deck
  socket.on("teacher:flashcards-race-next", (payload = {}) => {
    const code = (payload.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.flashcardsRace || !room.flashcardsRace.active) return;

    const state = room.flashcardsRace;
    const deck = Array.isArray(state.deck) ? state.deck : [];
    if (deck.length === 0) return;

    const nextIndex = (state.currentIndex || 0) + 1;

    // Reached the end of the deck → broadcast end event
    if (nextIndex >= deck.length) {
      state.active = false;
      io.to(code).emit("flashcards-race:end", {
        totalCards: deck.length,
      });
      return;
    }

    state.currentIndex = nextIndex;

    io.to(code).emit("flashcards-race:next", {
      card: deck[nextIndex],
      cardIndex: nextIndex,
      totalCards: deck.length,
    });
  });

  // Teacher awards a point (or N points) to the team that won that card
  socket.on("teacher:flashcards-race-award", (payload = {}) => {
    const code = (payload.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const { teamId, teamName, points } = payload;
    const safePoints =
      typeof points === "number" && !Number.isNaN(points) ? points : 1;

    if (teamId && room.teams?.[teamId]) {
      // This updates room.teams[teamId].score (used by some game UIs)
      updateTeamScore(room, teamId, safePoints);
    }

    let label = teamName;
    if (!label && teamId && room.teams?.[teamId]) {
      label =
        room.teams[teamId].teamName ||
        `Team-${String(teamId).slice(-4)}`;
    }

    // Notify all students so FlashcardsRaceTask can bump local scoreboard
    io.to(code).emit("flashcards-race:winner", {
      teamId: teamId || null,
      teamName: label || "Unknown team",
      points: safePoints,
    });

    // Refresh LiveSession scores (these still come from submissions;
    // if you later want race points reflected there, you can optionally
    // push pseudo-submissions too)
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  });

  // Teacher ends the race early (or after last card)
  socket.on("teacher:flashcards-race-end", (payload = {}) => {
    const code = (payload.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.flashcardsRace) return;

    const deck = Array.isArray(room.flashcardsRace.deck)
      ? room.flashcardsRace.deck
      : [];

    room.flashcardsRace = null;

    io.to(code).emit("flashcards-race:end", {
      totalCards: deck.length,
    });
  });

  // Live debate (experimental – unchanged here)
  socket.on("start-live-debate", ({ roomCode, postulate }) => {
    const session = getSessionByRoomCode(roomCode);
    const teams = session?.teams || [];
    const half = Math.ceil(teams.length / 2);
    teams.forEach((t, i) => {
      const side = i < half ? "for" : "against";
      io.to(t.socketId).emit("debate-start", {
        type: "live-debate",
        postulate,
        mySide: side,
        myTeamName: t.name,
        teamMembers: t.members || ["Member 1", "Member 2", "Member 3"],
        responses: [],
      });
    });
  });

  socket.on("debate-response", async (data) => {
    io.to(data.roomCode).emit("debate-new-response", data);
    // Future: when all teams have 3 responses → judge via AI
  });

  // Disconnect handling for persistent TeamSession
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