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
import { listSessions, getSessionDetails } from "./controllers/analyticsController.js";
import authRoutes from "./routes/auth.js";
import { authRequired } from "./middleware/authRequired.js";

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

buildRoomState(room) {
  if (!room) {
    return {
      teams: {},
      stations: {},
      scores: {},
      taskIndex: -1,
      locationCode: "Classroom",
      recentSubmissions: [],
    };
  }

  // Aggregate scores from all submissions in this room
  const scores = {};
  for (const sub of room.submissions || []) {
    if (!scores[sub.teamId]) scores[sub.teamId] = 0;
    scores[sub.teamId] += sub.points ?? 0;
  }

  // Take the last 20 submissions and convert them to the same
  // summary shape that we emit via the "taskSubmission" socket event.
  const recentSubmissions = (room.submissions || [])
    .slice(-20)
    .map((sub) => ({
      roomCode: sub.roomCode,
      teamId: sub.teamId,
      teamName: sub.teamName,
      taskIndex: sub.taskIndex,
      answerText: String(sub.answer ?? ""),
      correct: sub.correct,
      points: sub.points ?? 0,
      timeMs: sub.timeMs ?? null,
      submittedAt: sub.submittedAt,
    }));

  const state = {
    teams: room.teams,
    stations: room.stations,
    scores,
    taskIndex: room.taskIndex,
    locationCode: room.locationCode || "Classroom",
    recentSubmissions,
  };

  return state;
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

  socket.on("launchTaskset", (payload) => {
    handleTeacherNextTask(payload || {});
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

    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex;

    const task = room.taskset.tasks[idx];
    if (!task) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Task not found" });
      }
      return;
    }

    const effectiveTeamId = teamId || socket.data.teamId || socket.id;
    const team = room.teams[effectiveTeamId] || {};
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
    let pointsEarned = 0;
    if (correct === true) {
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

    reassignStationForTeam(room, effectiveTeamId);

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

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
    res.json(profile);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    res.json(profile);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.put("/api/profile/me", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    Object.assign(profile, req.body);
    await profile.save();
    res.json(profile);
  } catch (err) {
    console.error("Profile update failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.put("/api/profile", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    Object.assign(profile, req.body);
    await profile.save();
    res.json(profile);
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
    const updated = await TaskSet.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).lean();
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
