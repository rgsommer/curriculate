// ====================================================================
//  Curriculate Backend – Clean, Modern, Rewritten Index.js
//  Supports:
//   - Rooms, Sessions, Teams, Stations
//   - Station Location Protection (Classroom/Hallway/etc.)
//   - Task Launching + Student Submissions
//   - AI Rubric Scoring + AI Session Summaries
//   - Perspectives (multi-select worldview/approach tags)
//   - PDF + HTML Transcript Emailing
//   - Basic REST API for Profile, Subscription, TaskSets, Analytics
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
//import subscriptionRoutes from "./routes/subscriptionRoutes.js";

import { generateAIScore } from "./ai/aiScoring.js";
import { generateSessionSummaries } from "./ai/sessionSummaries.js";
import { sendTranscriptEmail } from "./email/transcriptEmailer.js";
import { generateTaskset as generateAiTaskset } from "./controllers/aiTasksetController.js";

const app = express();
const server = http.createServer(app);

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

/// Allow *any* Vercel preview deployments
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

// Must come BEFORE any routes:
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ====================================================================
//  EXPRESS MIDDLEWARE
// ====================================================================
app.use(bodyParser.json({ limit: "3mb" }));

// Mount subscriptionRouter properly
//app.use("/api/subscription", subscriptionRoutes);

// ====================================================================
//  SOCKET.IO – ONLY ONE INSTANCE
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
//  ROOM ENGINE (All In-Memory)
// ====================================================================
const rooms = {}; // rooms["8A"] = { teacherSocketId, teams, tasks, ... }

// Create a blank room object
function createRoom(roomCode, teacherSocketId) {
  return {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
    teams: {}, // teamId -> { teamName, color, members: [] }
    stations: {}, // stationId (e.g. "station-red") -> { roomLocation }
    taskset: null,
    taskIndex: -1,
    submissions: [],
    startedAt: null,
    isActive: false,
  };
}
  // --------------------------------------------------------------
  // Generic joinRoom (used by HostView / projector, optional teacher)
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

    if (typeof ack === "function") {
      ack({ ok: true, roomState: state });
    }
  });

// Build a transcript object from a room for analytics + emailing
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

  // Calculate team total scores
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

// Build per-participant stats for AI summaries
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

function buildRoomState(room) {
  if (!room) {
    return { teams: {}, stations: {}, scores: {}, taskIndex: -1 };
  }

  // Simple per-team score summary (aggregate points)
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
//  SOCKET.IO
// ====================================================================
io.on("connection", (socket) => {
  // --------------------------------------------------------------
  // Teacher: create room
  // --------------------------------------------------------------
  socket.on("teacher:createRoom", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    rooms[code] = createRoom(code, socket.id);
    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;
    socket.emit("room:created", { roomCode: code });
  });

    // --------------------------------------------------------------
  // Teacher loads a taskset (and alias used by client: "loadTaskset")
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

    io.to(code).emit("taskset:loaded", {
      name: taskset.name,
      tasks: taskset.tasks.length,
      subject: taskset.subject,
      gradeLevel: taskset.gradeLevel,
    });
  }

  socket.on("teacher:loadTaskset", (payload) => {
    handleTeacherLoadTaskset(payload || {});
  });

  // Alias used by LiveSession
  socket.on("loadTaskset", (payload) => {
    handleTeacherLoadTaskset(payload || {});
  });


  // --------------------------------------------------------------
  // Teacher starts session
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
  // Teacher send next task (and alias "launchTaskset")
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

    // Emit `task:launch` (modern contract)
    io.to(code).emit("task:launch", {
      index,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  }

  socket.on("teacher:nextTask", (payload) => {
    handleTeacherNextTask(payload || {});
  });

  // Alias used by LiveSession when launching a taskset
  socket.on("launchTaskset", (payload) => {
    handleTeacherNextTask(payload || {});
  });

  // --------------------------------------------------------------
  // Quick ad-hoc task (used by "Launch quick task" button)
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
  // Student joins room
  // --------------------------------------------------------------
  socket.on("student:joinRoom", (payload, ack) => {
  const { roomCode, teamName, members } = payload || {};
  const code = (roomCode || "").toUpperCase();
  const room = rooms[code];

  if (!room) {
    if (typeof ack === "function") {
      ack({ ok: false, error: "Room not found" });
    } else {
      socket.emit("join:error", { message: "Room not found" });
    }
    return;
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
    };
  } else {
    room.teams[teamId].teamName = displayName;
    room.teams[teamId].members = cleanMembers;
  }

  // Assuming you already have a buildRoomState(room) helper
  const state = buildRoomState(room);

  // Notify teacher & any connected views
  io.to(code).emit("room:state", state);
  io.to(room.teacherSocketId).emit("team:joined", {
    teamId,
    teamName: displayName,
    members: cleanMembers,
  });

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
    if (!room || !room.taskset) return;

    // Prefer explicit taskIndex; otherwise use the room's current index
    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex;

    const task = room.taskset.tasks[idx];
    if (!task) return;

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

    socket.emit("task:received");
    if (typeof ack === "function") {
      ack({ ok: true });
    }
  };

  // NEW canonical event:
  socket.on("student:submitAnswer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });

  // Legacy alias:
  socket.on("task:submit", (payload) => {
    handleStudentSubmit(payload);
  });

  // --------------------------------------------------------------
  // Teacher ends session + sends transcript
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
//  REST Routes (profile, subscription, tasksets, analytics)
// ====================================================================

// Simple DB check
app.get("/db-check", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, db: "reachable" });
  } catch (err) {
    console.error("DB check failed:", err);
    res.status(500).json({ ok: false, error: "DB unreachable" });
  }
});

// --------------------------------------------------------------------
// Teacher profile
// Support both /api/profile/me (new) and /api/profile (compat)
// --------------------------------------------------------------------

// Helper to ensure one profile exists
async function getOrCreateProfile() {
  let profile = await TeacherProfile.findOne();
  if (!profile) {
    profile = new TeacherProfile({});
    await profile.save();
  }
  return profile;
}

// GET /api/profile/me  (preferred)
app.get("/api/profile/me", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    res.json(profile);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// GET /api/profile  (legacy alias)
app.get("/api/profile", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    res.json(profile);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// PUT /api/profile/me – accept everything the Presenter Profile form sends
app.put("/api/profile/me", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();

    // Merge all fields coming from the front end
    Object.assign(profile, req.body);

    await profile.save();
    res.json(profile);
  } catch (err) {
    console.error("Profile update failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// PUT /api/profile – legacy alias, same behavior
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

// --------------------------------------------------------------------
// TaskSets – full REST for teacher app
// --------------------------------------------------------------------

// Create taskset
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

// List tasksets
app.get("/api/tasksets", async (req, res) => {
  try {
    const sets = await TaskSet.find().sort({ createdAt: -1 }).lean();
    res.json(sets);
  } catch (err) {
    console.error("GET /api/tasksets error:", err);
    res.status(500).json({ error: "Failed to load task sets" });
  }
});

// Get single taskset
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

// Update taskset
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

// Delete taskset
app.delete("/api/tasksets/:id", async (req, res) => {
  try {
    await TaskSet.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasksets/:id error:", err);
    res.status(500).json({ error: "Failed to delete task set" });
  }
});

// Generate an AI taskset
app.post("/api/ai/tasksets", generateAiTaskset);

// --------------------------------------------------------------------
// Analytics (stub) – to keep Reports page from blowing up
// --------------------------------------------------------------------
app.get("/analytics/sessions", async (req, res) => {
  try {
    // Later: query SessionAnalytics and return real data
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
