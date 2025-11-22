import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import mongoose from "mongoose";

import { generateAIScore } from "./ai/aiScoring.js";
import { generateSessionSummaries } from "./ai/sessionSummaries.js";
import { sendTranscriptEmail } from "./email/transcriptEmailer.js";
import Profile from "./models/TeacherProfile.js";
import TaskSet from "./models/TaskSet.js";

import tasksetRoutes from "./routes/tasksetRoutes.js";
import aiTasksetsRouter from "./routes/aiTasksets.js";
import teacherProfileRoutes from "./routes/teacherProfileRoutes.js";

// ----------------------------------------------------------------------------
// CORS FIRST
// ----------------------------------------------------------------------------
const app = express();

const allowedOrigins = [
  "https://set.curriculate.net",
  "https://play.curriculate.net",
  "https://curriculate.net",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// ----------------------------------------------------------------------------
// MongoDB
// ----------------------------------------------------------------------------
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Mongo connected"))
  .catch((err) => console.error("Mongo error", err));
  
// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------
app.use("/api/profile", teacherProfileRoutes);
app.use("/api/tasksets", tasksetRoutes);
app.use("/api/ai/tasksets", aiTasksetsRouter);

// ----------------------------------------------------------------------------
// HTTP + SOCKET SERVER
// ----------------------------------------------------------------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ----------------------------------------------------------------------------
// ROOM ENGINE (Socket)
// ----------------------------------------------------------------------------

const COLOR_SEQUENCE = ["RED", "BLUE", "GREEN", "YELLOW", "ORANGE", "PURPLE"];

// rooms[code] = { code, teacherSocketId, teams, stations, scores, taskset, ... }
const rooms = {};

function createEmptyStations() {
  return COLOR_SEQUENCE.map((color, index) => ({
    id: `station-${index + 1}`,
    color,
    assignedTeamId: null,
  }));
}

function createRoom(roomCode, teacherSocketId) {
  return {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
    teams: {}, // teamId -> { teamId, teamName, members: [], currentStationId, lastScannedStationId }
    stations: createEmptyStations(),
    scores: {}, // teamName -> number
    taskset: null,
    taskIndex: -1,
    submissions: [],
    startedAt: null,
    isActive: false,
    currentTaskStart: null,
  };
}

function recalcScores(room) {
  const scores = {};
  for (const sub of room.submissions) {
    const earned =
      sub.aiScore?.totalScore ??
      (sub.correct ? (sub.points ?? 0) : 0);

    scores[sub.teamName] = (scores[sub.teamName] || 0) + earned;
  }
  room.scores = scores;
}

function buildTranscript(room) {
  const tasks = room.taskset?.tasks || [];

  const taskRecords = tasks.map((t, i) => ({
    index: i,
    title: t.title || t.taskType,
    taskType: t.taskType,
    prompt: t.prompt,
    points: t.points ?? 10,
  }));

  recalcScores(room);

  const totalPossible = taskRecords.reduce(
    (s, t) => s + (t.points ?? 10),
    0
  );

  return {
    roomCode: room.code,
    tasksetName: room.taskset?.name,
    tasks: taskRecords,
    totalPossible,
    scores: room.scores,
    submissions: room.submissions,
  };
}

function computePerParticipantStats(room, transcript) {
  const tasks = transcript.tasks || [];
  const taskIndexMap = Object.fromEntries(tasks.map((t) => [t.index, t]));

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

    const task = taskIndexMap[sub.taskIndex];
    const pts = task?.points ?? 10;
    const earned =
      sub.aiScore?.totalScore ??
      (sub.correct ? pts : 0);

    entry.pointsEarned += earned;
    entry.pointsPossible += pts;

    if (sub.correct) entry.correctCount += 1;
  }

  const totalTasks = tasks.length;

  return Object.values(participants).map((p) => ({
    ...p,
    engagementPercent:
      totalTasks > 0
        ? Math.round((p.attempts / totalTasks) * 100)
        : 0,
    finalPercent:
      p.pointsPossible > 0
        ? Math.round((p.pointsEarned / p.pointsPossible) * 100)
        : 0,
  }));
}

function emitRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  recalcScores(room);

  io.to(roomCode).emit("roomState", {
    stations: room.stations,
    teams: room.teams,
    scores: room.scores,
    taskset: room.taskset
      ? {
          _id: room.taskset._id,
          name: room.taskset.name,
          tasks: room.taskset.tasks?.length ?? 0,
        }
      : null,
  });

  // Optional: keep existing leaderboard wiring happy
  const leaderboard = Object.entries(room.scores)
    .map(([teamName, score]) => ({ teamName, score }))
    .sort((a, b) => b.score - a.score);

  io.to(roomCode).emit("leaderboardUpdate", leaderboard);
}

// ----------------------------------------------------------------------------
// SOCKET.IO
// ----------------------------------------------------------------------------
io.on("connection", (socket) => {
  // ------------------------------------------------------------
  // TEACHER: create room (new style)
  // ------------------------------------------------------------
  socket.on("teacher:createRoom", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    rooms[code] = createRoom(code, socket.id);
    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;
    socket.emit("room:created", { roomCode: code });
    emitRoomState(code);
  });

  // ------------------------------------------------------------
  // TEACHER: create/join room (compat with LiveSession joinRoom)
  // ------------------------------------------------------------
  socket.on("joinRoom", ({ roomCode, name, role }) => {
    const code = (roomCode || "").toUpperCase();
    let room = rooms[code];

    if (!room && role === "teacher") {
      room = createRoom(code, socket.id);
      rooms[code] = room;
    } else if (!room) {
      socket.emit("join:error", { message: "Room not found" });
      return;
    }

    socket.join(code);
    socket.data.role = role || "teacher";
    socket.data.roomCode = code;

    if (role === "teacher") {
      room.teacherSocketId = socket.id;
    }

    socket.emit("room:created", { roomCode: code });
    emitRoomState(code);
  });

  // ------------------------------------------------------------
  // TEACHER: load taskset
  // ------------------------------------------------------------
  socket.on("teacher:loadTaskset", async ({ roomCode, tasksetId }) => {
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
      perspectives: taskset.perspectives ?? [],
    });

    emitRoomState(code);
  });

  // ------------------------------------------------------------
  // TEACHER: start session
  // ------------------------------------------------------------
  socket.on("teacher:startSession", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.startedAt = Date.now();
    room.isActive = true;
    room.taskIndex = -1;
    room.currentTaskStart = null;

    io.to(code).emit("session:started");
  });

  // ------------------------------------------------------------
  // TEACHER: next task
  // ------------------------------------------------------------
  socket.on("teacher:nextTask", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    room.taskIndex += 1;
    const idx = room.taskIndex;

    if (idx >= room.taskset.tasks.length) {
      io.to(code).emit("session:complete");
      return;
    }

    const task = room.taskset.tasks[idx];
    room.currentTaskStart = Date.now();

    io.to(code).emit("task:launch", {
      index: idx,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  });

  // ------------------------------------------------------------
  // STUDENT: join room (new style: student:joinRoom)
  // ------------------------------------------------------------
  socket.on("student:joinRoom", ({ roomCode, teamId, teamName, playerId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) {
      socket.emit("join:error", { message: "Room not found" });
      return;
    }

    socket.join(code);
    socket.data.role = "student";
    socket.data.roomCode = code;
    socket.data.teamId = teamId;
    socket.data.playerId = playerId;

    if (!room.teams[teamId]) {
      room.teams[teamId] = {
        teamId,
        teamName,
        members: [],
        currentStationId: null,
        lastScannedStationId: null,
      };
    }
    room.teams[teamId].members.push(playerId);

    // keep existing event for any old listeners
    io.to(code).emit("team:joined", { teamId, teamName, playerId });
    emitRoomState(code);
  });

  // ------------------------------------------------------------
  // STUDENT: join room (compat with student "join-room" + ack)
  // ------------------------------------------------------------
  socket.on("join-room", ({ roomCode, teamName }, ack) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Room not found" });
      }
      return;
    }

    // create a teamId based on name
    const teamId = `team-${teamName.trim().replace(/\s+/g, "-")}`;

    if (!room.teams[teamId]) {
      room.teams[teamId] = {
        teamId,
        teamName,
        members: [],
        currentStationId: null,
        lastScannedStationId: null,
      };
    }

    // assign first free station, or stick with any existing
    let station = room.stations.find((s) => s.assignedTeamId === teamId);
    if (!station) {
      station = room.stations.find((s) => !s.assignedTeamId);
      if (station) {
        station.assignedTeamId = teamId;
        room.teams[teamId].currentStationId = station.id;
      }
    }

    socket.join(code);
    socket.data.role = "student";
    socket.data.roomCode = code;
    socket.data.teamId = teamId;

    const color = station?.color ?? null;
    const stationLabel = color ? `${color} station` : "Station";

    emitRoomState(code);

    if (typeof ack === "function") {
      ack({
        ok: true,
        color,
        stationLabel,
        displays: room.taskset?.displays ?? [],
      });
    }
  });

  // ------------------------------------------------------------
  // STUDENT: submit answer
  // ------------------------------------------------------------
  socket.on("task:submit", async (payload) => {
    const { roomCode, teamId, teamName, playerId, taskIndex, answer } =
      payload || {};

    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const task = room.taskset?.tasks?.[taskIndex];
    if (!task) return;

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

    const correct =
      aiScore?.totalScore != null
        ? aiScore.totalScore > 0
        : task.correctAnswer != null
        ? String(answer).trim() === String(task.correctAnswer).trim()
        : null;

    const points = task.points ?? 10;
    const submittedAt = Date.now();
    const timeMs =
      room.currentTaskStart != null
        ? submittedAt - room.currentTaskStart
        : null;

    room.submissions.push({
      roomCode: code,
      teamId,
      teamName,
      playerId,
      taskIndex,
      answer,
      correct,
      points,
      aiScore,
      submittedAt,
    });

    recalcScores(room);

    // find station for this team
    const team = room.teams[teamId];
    const stationId = team?.currentStationId || null;

    // live submission bubble for LiveSession
    io.to(code).emit("taskSubmission", {
      teamId,
      teamName,
      stationId,
      answer,
      correct,
      timeMs,
    });

    emitRoomState(code);

    socket.emit("task:received");
  });

  // ------------------------------------------------------------
  // TEACHER: end session + email transcript
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

      if (!teacherEmail) {
        socket.emit("transcript:error", {
          message: "Teacher email missing",
        });
        return;
      }

      try {
        const transcript = buildTranscript(room);
        const stats = computePerParticipantStats(room, transcript);

        let aiSummary = null;
        if (process.env.OPENAI_API_KEY) {
          aiSummary = await generateSessionSummaries({
            transcript,
            perParticipantStats: stats,
            assessmentCategories: assessmentCategories || [],
            perspectives: perspectives || [],
          });
        }

        await sendTranscriptEmail({
          to: teacherEmail,
          transcript,
          aiSummary,
          includeIndividualReports,
          schoolName,
          perspectives,
        });

        socket.emit("transcript:sent", { to: teacherEmail });
      } catch (err) {
        console.error("Transcript email error:", err);
        socket.emit("transcript:error", {
          message: "Failed to generate or send transcript",
        });
      }
    }
  );
});

// ----------------------------------------------------------------------------
// Fallback 404 (with CORS headers)
// ----------------------------------------------------------------------------
app.use((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.status(404).json({ error: "Not found" });
});

// ----------------------------------------------------------------------------
// Server start
// ----------------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
});
