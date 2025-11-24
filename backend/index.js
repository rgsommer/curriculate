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

const app = express();
const server = http.createServer(app);

// ====================================================================
//  CORS
// ====================================================================
const allowedOrigins = [
  // Production frontends
  "https://set.curriculate.net",
  "https://play.curriculate.net",
  "https://curriculate.net",
  "https://www.curriculate.net",
  "https://api.curriculate.net",

  // Local dev
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

// Subscription / MyPlan routes
app.use("/api/subscription", subscriptionRoutes);

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

// Create a new room with a default set of stations
function createRoom(roomCode, teacherSocketId) {
  // Create 8 default stations: station-1 .. station-8
  const stations = {};
  const NUM_STATIONS = 8;
  for (let i = 1; i <= NUM_STATIONS; i++) {
    const id = `station-${i}`;
    stations[id] = {
      id,
      assignedTeamId: null,
    };
  }

  return {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
    teams: {},    // teamId -> { teamId, teamName, members: [], currentStationId, ... }
    stations,     // stationId -> { id, assignedTeamId }
    taskset: null,
    taskIndex: -1,
    submissions: [],
    startedAt: null,
    isActive: false,
  };
}

// Build a transcript from a room
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

// Per-participant stats
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
    if (sub.correct) {
      entry.correctCount += 1;
    }
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

// Compact room state for clients
function buildRoomState(room) {
  if (!room) {
    return { teams: {}, stations: {}, scores: {}, taskIndex: -1 };
  }

  const scores = {};
  for (const sub of room.submissions) {
    if (!scores[sub.teamId]) scores[sub.teamId] = 0;
    scores[sub.teamId] += sub.points ?? 0;
  }

  return {
    teams: room.teams,
    stations: room.stations,
    scores,
    taskIndex: room.taskIndex,
  };
}

// ====================================================================
//  SOCKET.IO – EVENT HANDLERS
// ====================================================================
io.on("connection", (socket) => {
  // --------------------------------------------------------------
  // Teacher: create room (LiveSession)
  // --------------------------------------------------------------
  socket.on("teacher:createRoom", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    let room = rooms[code];

    // Reuse an existing room if it already exists (preserve teams)
    if (room) {
      room.teacherSocketId = socket.id;
    } else {
      room = rooms[code] = createRoom(code, socket.id);
    }

    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;

    const state = buildRoomState(room);
    socket.emit("room:created", { roomCode: code });
    socket.emit("room:state", state);
    socket.emit("roomState", state);
  });

  // --------------------------------------------------------------
  // Generic joinRoom (HostView / viewer / reconnect)
  // --------------------------------------------------------------
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

  // --------------------------------------------------------------
  // Teacher loads a taskset
  // --------------------------------------------------------------
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

  // --------------------------------------------------------------
  // Teacher starts a session
  // --------------------------------------------------------------
  socket.on("teacher:startSession", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.startedAt = Date.now();
    room.isActive = true;
    room.taskIndex = -1;

    io.to(code).emit("session:started");
  });

  // --------------------------------------------------------------
  // Teacher sends next task (and alias "launchTaskset")
  // --------------------------------------------------------------
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

  // --------------------------------------------------------------
  // Quick ad-hoc task from teacher
  // --------------------------------------------------------------
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

  // --------------------------------------------------------------
  // Student joins room – assign a station immediately
  // --------------------------------------------------------------
  socket.on("student:joinRoom", (payload, ack) => {
    const { roomCode, teamName, members } = payload || {};
    const code = (roomCode || "").toUpperCase();

    // Allow students to join first – create room if needed.
    let room = rooms[code];
    if (!room) {
      room = rooms[code] = createRoom(code, null);
    }

    socket.join(code);
    socket.data.role = "student";
    socket.data.roomCode = code;

    // Use this socket as the canonical team id
    const teamId = socket.id;
    socket.data.teamId = teamId;

    const cleanMembers =
      Array.isArray(members) && members.length > 0
        ? members.map((m) => String(m).trim()).filter(Boolean)
        : [];

    const displayName =
      teamName ||
      cleanMembers[0] ||
      `Team-${String(teamId).slice(-4)}`;

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

    // Ensure stations exist (defensive – createRoom already does this)
    if (!room.stations || Object.keys(room.stations).length === 0) {
      room.stations = {};
      const NUM_STATIONS = 8;
      for (let i = 1; i <= NUM_STATIONS; i++) {
        const id = `station-${i}`;
        room.stations[id] = { id, assignedTeamId: null };
      }
    }

    // If this team has no current station yet, assign one.
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

    // Build and broadcast updated room state
    const state = buildRoomState(room);

    // Notify all clients in the room
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // Notify teacher (if connected) that a team has joined
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

  // --------------------------------------------------------------
  // Student submits answer
  // --------------------------------------------------------------
  const handleStudentSubmit = async (payload, ack) => {
    const { roomCode, teamId, taskIndex, answer } = payload || {};

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

    room.submissions.push({
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      playerId: socket.data.playerId || null,
      taskIndex: idx,
      answer,
      correct,
      points: task.points ?? 10,
      aiScore,
      submittedAt: Date.now(),
    });

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

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

  // --------------------------------------------------------------
  // Teacher ends session + sends transcript email
  // --------------------------------------------------------------
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

// TaskSets CRUD
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

// AI Taskset
app.post("/api/ai/tasksets", generateAiTaskset);

// Analytics stub
app.get("/analytics/sessions", async (req, res) => {
  try {
    res.json({ sessions: [] });
  } catch (err) {
    console.error("GET /analytics/sessions error:", err);
    res.status(500).json({ error: "Failed to load analytics sessions" });
  }
});

// ====================================================================
//  Start Server
// ====================================================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
});
