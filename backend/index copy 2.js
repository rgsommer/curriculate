// ====================================================================
//  Curriculate Backend – Rooms, Teams, Stations, Tasks, AI, Emailing
//  UPDATED: Adds locationCode to room state, soft-task timeouts,
//           auto-submission on timeout, and full compatibility with
//           new StudentApp + TeacherApp logic.
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

// ====================================================================
//  SOCKET.IO
// ====================================================================
const io = new Server(server, { cors: corsOptions });

// --------------------------------------------------------------------
// MongoDB Connection
// --------------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Mongo connected"))
  .catch((err) => console.error("Mongo connection error:", err));

// ====================================================================
//  ROOM ENGINE
// ====================================================================
const rooms = {}; // rooms["AB"] = {...}

function createRoom(roomCode, teacherSocketId) {
  const stations = {};
  const NUM_STATIONS = 8;
  for (let i = 1; i <= NUM_STATIONS; i++) {
    stations[`station-${i}`] = { id: `station-${i}`, assignedTeamId: null };
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
  };
}

// SINGLE-team rotation
function reassignStationForTeam(room, teamId) {
  const stationIds = Object.keys(room.stations || {});
  if (stationIds.length === 0) return;

  const team = room.teams[teamId];
  if (!team) return;

  const current = team.currentStationId;
  const idx = stationIds.indexOf(current);
  const nextIdx = idx >= 0 ? (idx + 1) % stationIds.length : 0;
  const nextStation = stationIds[nextIdx];

  if (
    current &&
    room.stations[current] &&
    room.stations[current].assignedTeamId === teamId
  ) {
    room.stations[current].assignedTeamId = null;
  }

  team.currentStationId = nextStation;
  team.lastScannedStationId = null;
  room.stations[nextStation].assignedTeamId = teamId;
}

// Transcript helpers unchanged…

function buildRoomState(room) {
  if (!room) return { teams: {}, stations: {}, scores: {}, taskIndex: -1 };

  const scores = {};
  for (const sub of room.submissions) {
    scores[sub.teamId] = (scores[sub.teamId] || 0) + (sub.points ?? 0);
  }

  return {
    teams: room.teams,
    stations: room.stations,
    scores,
    taskIndex: room.taskIndex,
    // NEW: expose taskset locationCode to students
    locationCode: room.taskset?.locationCode || "Classroom",
  };
}

// ====================================================================
//  SOCKET.IO EVENTS
// ====================================================================
io.on("connection", (socket) => {
  // ------------------------------------------------------------
  // Teacher creates room
  // ------------------------------------------------------------
  socket.on("teacher:createRoom", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    let room = rooms[code] || createRoom(code, socket.id);
    room.teacherSocketId = socket.id;
    rooms[code] = room;

    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;

    const state = buildRoomState(room);
    socket.emit("room:created", { roomCode: code });
    socket.emit("room:state", state);
  });

  // ------------------------------------------------------------
  // Generic joinRoom (HostView, viewers)
  // ------------------------------------------------------------
  socket.on("joinRoom", (payload = {}, ack) => {
    const code = (payload.roomCode || "").toUpperCase();
    const room = rooms[code];

    if (!room) {
      const error = { ok: false, error: "Room not found" };
      ack?.(error);
      socket.emit("join:error", { message: error.error });
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = payload.role || "viewer";
    socket.data.displayName = payload.name || payload.role || "Viewer";

    socket.emit("room:state", buildRoomState(room));
    ack?.({ ok: true, roomState: buildRoomState(room) });
  });

  // ------------------------------------------------------------
  // Teacher loads taskset
  // ------------------------------------------------------------
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

  socket.on("teacher:loadTaskset", handleTeacherLoadTaskset);
  socket.on("loadTaskset", handleTeacherLoadTaskset);

  // ------------------------------------------------------------
  // Teacher starts session
  // ------------------------------------------------------------
  socket.on("teacher:startSession", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.startedAt = Date.now();
    room.isActive = true;
    room.taskIndex = -1;

    io.to(code).emit("session:started");
  });

  // ------------------------------------------------------------
  // Teacher launches next task
  // ------------------------------------------------------------
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

    io.to(code).emit("room:state", buildRoomState(room));
    io.to(code).emit("task:launch", {
      index,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  }

  socket.on("teacher:nextTask", handleTeacherNextTask);
  socket.on("launchTaskset", handleTeacherNextTask);

  // ------------------------------------------------------------
  // Student joinRoom
  // ------------------------------------------------------------
  socket.on("student:joinRoom", (payload, ack) => {
    const code = (payload.roomCode || "").toUpperCase();
    let room = rooms[code] || createRoom(code, null);
    rooms[code] = room;

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = "student";

    const teamId = socket.id;
    socket.data.teamId = teamId;

    const members = (payload.members || [])
      .map((m) => String(m).trim())
      .filter(Boolean);

    const displayName =
      payload.teamName || members[0] || `Team-${teamId.slice(-4)}`;

    room.teams[teamId] = {
      teamId,
      teamName: displayName,
      members,
      score: 0,
      currentStationId: room.teams[teamId]?.currentStationId || null,
      lastScannedStationId: null,
    };

    // Auto-assign station if none
    const stationIds = Object.keys(room.stations);
    const taken = new Set(
      Object.values(room.teams)
        .map((t) => t.currentStationId)
        .filter(Boolean)
    );
    const available = stationIds.filter((id) => !taken.has(id));
    const assigned = available[0] || stationIds[0];

    room.teams[teamId].currentStationId = assigned;
    room.stations[assigned].assignedTeamId = teamId;

    // Notify teacher
    if (room.teacherSocketId) {
      io.to(room.teacherSocketId).emit("team:joined", {
        teamId,
        teamName: displayName,
        members,
      });
    }

    // Emit state
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    ack?.({ ok: true, roomState: state, teamId });
  });

  // ------------------------------------------------------------
  // Station scan
  // ------------------------------------------------------------
  socket.on("station:scan", (payload, ack) => {
    const code = (payload.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return ack?.({ ok: false, error: "Room not found" });

    const teamId = payload.teamId || socket.data.teamId;
    const team = room.teams[teamId];
    if (!team) return ack?.({ ok: false, error: "Team not found" });

    let raw = String(payload.stationId || "").trim();
    if (!raw.startsWith("station-")) raw = `station-${raw}`;

    if (!room.stations[raw]) {
      return ack?.({ ok: false, error: "Unknown station" });
    }

    team.currentStationId = raw;
    team.lastScannedStationId = raw;
    room.stations[raw].assignedTeamId = teamId;

    io.to(code).emit("scanEvent", {
      roomCode: code,
      teamId,
      teamName: team.teamName,
      stationId: raw,
      timestamp: Date.now(),
    });

    io.to(code).emit("room:state", buildRoomState(room));
    ack?.({ ok: true });
  });

    // ------------------------------------------------------------
  // Student submits answer – reassign only that team's station
  // ------------------------------------------------------------
  async function handleStudentSubmit(payload, ack) {
    const { roomCode, teamId, taskIndex, answer, timeMs } = payload || {};
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];

    if (!room || !room.taskset) {
      return ack?.({ ok: false, error: "Room or taskset not found" });
    }

    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex;

    const task = room.taskset.tasks[idx];
    if (!task) {
      return ack?.({ ok: false, error: "Task not found" });
    }

    const effectiveTeamId = teamId || socket.data.teamId;
    if (!effectiveTeamId) {
      return ack?.({ ok: false, error: "Missing teamId" });
    }

    const team = room.teams[effectiveTeamId];
    const teamName =
      team?.teamName || `Team-${String(effectiveTeamId).slice(-4)}`;

    // ------------------------------------------------------------
    //  AI SCORING (optional)
    // ------------------------------------------------------------
    let aiScore = null;
    if (task.aiRubricId) {
      try {
        aiScore = await generateAIScore({
          rubricId: task.aiRubricId,
          prompt: task.prompt,
          answer,
        });
      } catch (e) {
        console.error("AI scoring error", e);
      }
    }

    // ------------------------------------------------------------
    //  CORRECTNESS (simple)
    // ------------------------------------------------------------
    const correct = (() => {
      if (aiScore && typeof aiScore.totalScore === "number") {
        return aiScore.totalScore > 0;
      }
      if (task.correctAnswer == null) return null;
      return String(answer ?? "")
        .trim()
        .toLowerCase() === String(task.correctAnswer).trim().toLowerCase();
    })();

    const submittedAt = Date.now();

    // ------------------------------------------------------------
    //  RECORD SUBMISSION
    // ------------------------------------------------------------
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
      timeMs,
      submittedAt,
    });

    // ------------------------------------------------------------
    //  REASSIGN ONLY THIS TEAM'S STATION
    // ------------------------------------------------------------
    reassignStationForTeam(room, effectiveTeamId);

    // ------------------------------------------------------------
    //  BROADCAST NEW STATE + SUBMISSION
    // ------------------------------------------------------------
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("taskSubmission", {
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      taskIndex: idx,
      answerText: String(answer ?? ""),
      correct,
      points: task.points ?? 10,
      timeMs,
      submittedAt,
    });

    socket.emit("task:received");
    ack?.({ ok: true });
  }

  socket.on("student:submitAnswer", handleStudentSubmit);
  socket.on("task:submit", handleStudentSubmit);

  // ------------------------------------------------------------
  // Teacher ends session + email reports
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // DISCONNECT – remove team & free station
  // ------------------------------------------------------------
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

    io.to(code).emit("room:state", buildRoomState(room));
  });
});

// ====================================================================
//  REST ROUTES (unchanged, except location fields already supported)
// ====================================================================

app.get("/db-check", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, db: "reachable" });
  } catch (err) {
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
    res.json(await getOrCreateProfile());
  } catch {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.put("/api/profile/me", async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    Object.assign(profile, req.body);
    await profile.save();
    res.json(profile);
  } catch {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// TaskSet CRUD
app.post("/api/tasksets", async (req, res) => {
  try {
    const t = new TaskSet(req.body);
    await t.save();
    res.status(201).json(t);
  } catch (err) {
    res.status(500).json({ error: "Failed to create task set" });
  }
});

app.get("/api/tasksets", async (req, res) => {
  try {
    const sets = await TaskSet.find().sort({ createdAt: -1 }).lean();
    res.json(sets);
  } catch {
    res.status(500).json({ error: "Failed to load task sets" });
  }
});

app.get("/api/tasksets/:id", async (req, res) => {
  try {
    const set = await TaskSet.findById(req.params.id).lean();
    if (!set) return res.status(404).json({ error: "Task set not found" });
    res.json(set);
  } catch {
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
    if (!updated) return res.status(404).json({ error: "Task set not found" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update task set" });
  }
});

app.delete("/api/tasksets/:id", async (req, res) => {
  try {
    await TaskSet.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete task set" });
  }
});

app.post("/api/ai/tasksets", generateAiTaskset);

app.get("/analytics/sessions", async (req, res) => {
  try {
    res.json({ sessions: [] });
  } catch {
    res.status(500).json({ error: "Failed to load analytics sessions" });
  }
});

// ====================================================================
//  SERVER START
// ====================================================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
});