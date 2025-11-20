// backend/index.js
import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server as SocketIOServer } from "socket.io";

import tasksRouter from "./routes/tasks.js";
import tasksetRouter from "./routes/tasksets.js";
import sessionsRouter from "./routes/sessions.js";

import TaskSet from "./models/TaskSet.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import uploadCsvRouter from "./routes/uploadCsv.js";
import analyticsRouter from "./routes/analytics.js";
import { updateTasksetAnalytics } from "./services/tasksetAnalyticsService.js";
import teacherProfileRoutes from "./routes/teacherProfileRoutes.js";
import tasksetRoutes from "./routes/tasksetRoutes.js";
import aiTasksetsRouter from "./routes/aiTasksets.js";

import {
  allTeamsSubmitted,
  advanceToNextTask,
} from "./services/gameFlow.js";

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = [
  "http://localhost:5173", // teacher app
  "http://localhost:5174", // student app
];

const io = new SocketIOServer(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })
);

app.use(express.json());
app.use("/api/profile", teacherProfileRoutes);
app.use("/api/tasksets", tasksetRoutes);
app.use("/api/ai/tasksets", aiTasksetsRouter);

// very simple health route
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Curriculate backend alive" });
});

// DB health check route
app.get("/db-check", (req, res) => {
  const state = mongoose.connection.readyState;
  res.json({
    status:
      state === 1
        ? "✅ MongoDB connected"
        : state === 2
        ? "⏳ MongoDB connecting"
        : "❌ MongoDB not connected",
    readyState: state,
  });
});

// REST routes
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/tasksets", tasksetRouter);
app.use("/tasks", tasksRouter);
app.use("/sessions", sessionsRouter);
app.use("/upload-csv", uploadCsvRouter);
app.use("/analytics", analyticsRouter);

/* ------------------------------------------------------------------
   IN-MEMORY ROOM / STATION MODEL
   ------------------------------------------------------------------ */

const rooms = {};

/**
 * Ensure a room exists with station / team / score structure.
 * Stations are station-1 … station-8.
 */
function ensureRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      code,
      stations: Array.from({ length: 8 }, (_, i) => ({
        id: `station-${i + 1}`,
        assignedTeamId: null,
        nextTeamId: null,
      })),
      teams: {}, // teamId -> { teamId, teamName, teamColor, members, perMemberDone, currentStationId, lastScannedStationId }
      scores: {}, // teamName -> score
      roundPlan: null, // { teamToStation: { teamId -> stationId } }
      currentTask: null, // { prompt, correctAnswer, ... }
      taskset: null, // { _id, name, tasks, mode }
      currentTaskIndex: null,
      submissions: [],
    };
  }
}

/** Broadcast the full room state to all clients in this room. */
function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit("roomState", room);
}

/**
 * Return a derangement of [0..n-1] if possible:
 * a permutation with no fixed points.
 */
function derangeIndexes(n) {
  if (n <= 1) return Array.from({ length: n }, (_, i) => i);
  let tries = 0;
  while (tries < 50) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (arr[i] === i) {
        ok = false;
        break;
      }
    }
    if (ok) return arr;
    tries++;
  }
  // fallback simple rotation
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

/**
 * Build a rotation plan for the current round.
 * After a task, each team should move to a different station.
 */
function buildRoundPlan(room) {
  if (!room) return;
  const activeStations = room.stations.filter((s) => s.assignedTeamId);
  const n = activeStations.length;
  if (n <= 1) {
    room.roundPlan = null;
    return;
  }

  const teamIds = activeStations.map((s) => s.assignedTeamId);
  const stationIds = activeStations.map((s) => s.id);
  const perm = derangeIndexes(n);

  const teamToStation = {};
  for (let i = 0; i < n; i++) {
    const teamId = teamIds[i];
    const destStationId = stationIds[perm[i]];
    teamToStation[teamId] = destStationId;
  }

  room.roundPlan = { teamToStation };
}

/* ------------------------------------------------------------------
   SOCKET.IO
   ------------------------------------------------------------------ */

io.on("connection", (socket) => {
  console.log("🔌 socket connected", socket.id);

  /** Quick peek at a room’s state without joining */
  socket.on("peekRoom", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    if (!code) return;
    ensureRoom(code);
    broadcastRoom(code);
  });

  /**
   * Join a room as teacher/host/viewer or student team.
   * For students, we create a team and assign a station.
   */
  socket.on(
    "joinRoom",
    ({ roomCode, name, role, teamName, members, teamColor }) => {
      const code = (roomCode || "").toUpperCase();
      if (!code) return;
      ensureRoom(code);
      const room = rooms[code];

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.role = role || "student";

      // Teacher / host / viewer just listen to roomState
      if (
        socket.data.role === "teacher" ||
        socket.data.role === "host" ||
        socket.data.role === "viewer"
      ) {
        broadcastRoom(code);
        return;
      }

      // From here on: student station / team.

      // Prevent color collisions if used
      if (teamColor) {
        const taken = Object.values(room.teams).some(
          (t) => t.teamColor === teamColor
        );
        if (taken) {
          socket.emit("colorTaken", teamColor);
          return;
        }
      }

      const finalTeamName =
        (teamName && teamName.trim()) || `Team-${socket.id.slice(-4)}`;
      const finalMembers = Array.isArray(members)
        ? members.map((m) => (m || "").trim()).filter(Boolean)
        : [];

      const teamId = socket.id;

      const team = {
        teamId,
        teamName: finalTeamName,
        teamColor: teamColor || null,
        members: finalMembers,
        perMemberDone: {},
        currentStationId: null,
        lastScannedStationId: null,
      };

      // assign team to first free station, if available
      const freeStation = room.stations.find((s) => !s.assignedTeamId);
      if (freeStation) {
        freeStation.assignedTeamId = teamId;
        freeStation.nextTeamId = null;
        team.currentStationId = freeStation.id;
      }

      room.teams[teamId] = team;
      if (!room.scores[team.teamName]) room.scores[team.teamName] = 0;

      socket.data.teamId = teamId;

      // confirm join
      socket.emit("joinConfirmed", {
        teamId,
        teamName: team.teamName,
        teamColor: team.teamColor,
        members: team.members,
        stationId: team.currentStationId,
      });

      broadcastRoom(code);
    }
  );

  /**
   * QR station scan.
   * Payload: { roomCode, teamId, stationId }
   */
  socket.on("station:scan", ({ roomCode, teamId, stationId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const tid = teamId || socket.id;
    const team = room.teams[tid];
    if (!team) return;

    const assignedId = team.currentStationId || null;

    // Only accept a scan if it matches the team’s assigned station
    if (!assignedId || assignedId !== stationId) {
      console.log(
        `Ignoring scan for wrong station: team=${team.teamName}, assigned=${assignedId}, scanned=${stationId}`
      );
      // Do NOT change lastScannedStationId or broadcast
      return;
    }

    // ✅ Valid scan for this assignment
    team.lastScannedStationId = stationId;

    const event = {
      roomCode: code,
      teamId: tid,
      teamName: team.teamName,
      stationId,
      assignedStationId: assignedId,
      timestamp: Date.now(),
    };

    console.log(
      `Team ${team.teamName} scanned correct station ${stationId} in room ${code}`
    );

    // Broadcast a scan event just for teacher/host UIs to display
    io.to(code).emit("scanEvent", event);

    // And broadcast updated roomState as usual
    broadcastRoom(code);
  });

  /** Student changes team color (legacy, optional) */
  socket.on("changeTeamColor", ({ roomCode, color }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;
    const team = room.teams[socket.id];
    if (!team) return;

    const taken = Object.values(room.teams).some(
      (t) => t.teamColor === color && t.teamId !== socket.id
    );
    if (taken) {
      socket.emit("colorTaken", color);
      return;
    }

    team.teamColor = color;
    broadcastRoom(code);
  });

  /**
   * Teacher launches a single ad-hoc task.
   */
  socket.on("teacherLaunchTask", (payload = {}) => {
    const { roomCode } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;
    if (socket.data.role !== "teacher" && socket.data.role !== "host") return;

    const task = payload.task || {};
    const prompt = (payload.prompt ?? task.prompt ?? "").trim();
    const correctAnswer = (
      payload.correctAnswer ?? task.correctAnswer ?? ""
    ).trim();

    room.currentTask = {
      prompt,
      correctAnswer,
      options: [],
      taskType: "short-answer",
      points: 10,
      at: Date.now(),
      submissions: [],
    };

    // new round → build rotation plan
    buildRoundPlan(room);

    // reset per-member done flags for this round
    Object.values(room.teams).forEach((t) => {
      t.perMemberDone = t.perMemberDone || {};
    });

    io.to(code).emit("taskUpdate", room.currentTask);
    io.to(code).emit("roundStarted", room.currentTask);
  });

  /**
   * Load a saved TaskSet into the room.
   */
  socket.on("loadTaskset", async ({ roomCode, tasksetId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    if (mongoose.connection.readyState !== 1) {
      socket.emit("error", { msg: "DB not connected" });
      return;
    }

    try {
      const ts = await TaskSet.findById(tasksetId).lean();
      if (!ts) return socket.emit("error", { msg: "Taskset not found" });

      room.taskset = {
        _id: ts._id,
        name: ts.name,
        tasks: ts.tasks || [],
        mode: (ts.tasks || []).every((t) => t.linear)
          ? "linear"
          : "mixed",
      };

      room.currentTask = null;
      room.roundPlan = null;
      room.currentTaskIndex = null;
      room.submissions = [];

      io.to(code).emit("tasksetLoaded", {
        name: ts.name,
        numTasks: (ts.tasks || []).length,
        tasksetId: ts._id,
      });
      broadcastRoom(code);
    } catch (err) {
      console.error("loadTaskset error", err);
      socket.emit("error", { msg: "Load failed" });
    }
  });

  /**
   * Launch next task from loaded taskset (or first, if none yet).
   */
  socket.on("launchTaskset", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    // When (re)starting, ensure submissions are cleared
    if (room.currentTaskIndex === null) {
      room.submissions = [];
    }

    // Build a new rotation plan for this round
    buildRoundPlan(room);

    advanceToNextTask(io, room);
  });

  /**
   * Student submits a task.
   * Payload: { roomCode, correct, timeMs, memberName, teamId, answerText }
   */
  socket.on(
    "submitTask",
    ({ roomCode, correct, timeMs, memberName, teamId, answerText }) => {
      const code = (roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) return;
      if (!room.currentTask) return;

      const tid = teamId || socket.id;
      const team = room.teams[tid];
      if (!team) return;

      // 1) determine correctness
      let isCorrect = !!correct;
      if (!isCorrect && room.currentTask?.correctAnswer) {
        const expected = room.currentTask.correctAnswer.trim().toLowerCase();
        const got = (answerText || "").trim().toLowerCase();
        if (expected && got && expected === got) {
          isCorrect = true;
        }
      }

      // 2) per-member done
      team.perMemberDone = team.perMemberDone || {};
      if (memberName) {
        team.perMemberDone[memberName] = true;
      }

      // 3) record submission once per team for this task
      room.currentTask.submissions = room.currentTask.submissions || [];
      const already = room.currentTask.submissions.find(
        (s) => s.teamId === tid
      );

      const submission = {
        teamId: tid,
        playerId: memberName || socket.id,
        answerText: (answerText || "").trim(),
        correct: isCorrect,
        timeMs: typeof timeMs === "number" ? timeMs : null,
        taskIndex:
          typeof room.currentTaskIndex === "number"
            ? room.currentTaskIndex
            : 0,
      };

      if (!already) {
        room.currentTask.submissions.push({
          teamId: tid,
          timeMs: submission.timeMs ?? 999999,
          correct: submission.correct,
        });
      }

      // 3b) also push into room.submissions for end-of-taskset analytics
      room.submissions = room.submissions || [];
      room.submissions.push(submission);

      // 4) base scoring by team name
      const label = team.teamName;
      if (!room.scores[label]) room.scores[label] = 0;
      if (isCorrect) {
        room.scores[label] += room.currentTask.points || 10;
      }

      // 5) relative speed bonus — ONLY for correct teams
      const correctSubs = room.currentTask.submissions
        .filter((s) => s.correct)
        .sort(
          (a, b) => (a.timeMs || 999999) - (b.timeMs || 999999)
        );

      const speedBonusByTeam = {};
      correctSubs.forEach((entry, idx) => {
        if (idx === 0) speedBonusByTeam[entry.teamId] = 5;
        else if (idx === 1) speedBonusByTeam[entry.teamId] = 3;
        else if (idx === 2) speedBonusByTeam[entry.teamId] = 2;
        else speedBonusByTeam[entry.teamId] = 0;
      });

      const bonus = isCorrect ? speedBonusByTeam[tid] ?? 0 : 0;
      room.scores[label] += bonus;

      // 6) rotation for this team, according to roundPlan
      const currentStation = room.stations.find(
        (s) => s.assignedTeamId === tid
      );
      const plan = room.roundPlan;

      // new assignment after this submission → require a fresh scan next time
      team.lastScannedStationId = null;

      if (plan && currentStation) {
        // Leave the current station
        currentStation.assignedTeamId = null;

        // If there's a team waiting to enter this station, assign it now
        if (currentStation.nextTeamId) {
          const waitingTeamId = currentStation.nextTeamId;
          currentStation.assignedTeamId = waitingTeamId;
          currentStation.nextTeamId = null;
          if (room.teams[waitingTeamId]) {
            room.teams[waitingTeamId].currentStationId =
              currentStation.id;
          }
        }

        // Move this team to its planned destination
        const destStationId = plan.teamToStation[tid];
        if (destStationId) {
          const destStation = room.stations.find(
            (s) => s.id === destStationId
          );
          if (destStation) {
            if (!destStation.assignedTeamId) {
              destStation.assignedTeamId = tid;
              destStation.nextTeamId = null;
              team.currentStationId = destStation.id;
            } else {
              destStation.nextTeamId = tid;
              team.currentStationId = null;
            }
          } else {
            team.currentStationId = null;
          }
        } else {
          team.currentStationId = null;
        }
      } else {
        // No plan → leave them where they are
        if (currentStation) {
          currentStation.assignedTeamId = tid;
          currentStation.nextTeamId = null;
          team.currentStationId = currentStation.id;
        }
      }

      // 7) notify host/teacher
      io.to(code).emit("taskSubmission", {
        teamId: team.teamId,
        teamName: team.teamName,
        correct: isCorrect,
        timeMs: submission.timeMs || 0,
        memberName,
        answerText: answerText || "",
        at: Date.now(),
      });

      io.to(code).emit("leaderboardUpdate", room.scores);
      broadcastRoom(code);

      // 8) Auto-advance when all teams have submitted
      if (allTeamsSubmitted(room)) {
        advanceToNextTask(io, room);
      }
    }
  );

  /**
   * Host manual scoring (bonus / override).
   */
  socket.on(
    "hostScoreSubmission",
    ({ roomCode, teamId, points = 0 }) => {
      const code = (roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) return;
      const team = room.teams[teamId];
      if (!team) return;
      const label = team.teamName;
      if (!room.scores[label]) room.scores[label] = 0;
      room.scores[label] += Number(points) || 0;

      io.to(code).emit("leaderboardUpdate", room.scores);
      io.to(code).emit("taskSubmissionScored", {
        teamId,
        teamName: team.teamName,
        points: Number(points) || 0,
      });
      broadcastRoom(code);
    }
  );

  /** Clean up on disconnect */
  socket.on("disconnect", () => {
    const code = socket.data?.roomCode;
    if (!code) return;
    const room = rooms[code];
    if (!room) return;

    const tid = socket.data.teamId;
    if (tid && room.teams[tid]) {
      // remove team from stations
      room.stations.forEach((s) => {
        if (s.assignedTeamId === tid) s.assignedTeamId = null;
        if (s.nextTeamId === tid) s.nextTeamId = null;
      });
      delete room.teams[tid];
    }

    broadcastRoom(code);
  });
});

/* ------------------------------------------------------------------
   MONGOOSE + SERVER START
   ------------------------------------------------------------------ */

const PORT = process.env.PORT || 10000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/curriculate";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");

    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. ` +
            "Try `lsof -i :PORT` or `netstat -anp | grep :PORT` " +
            "to find the PID, then kill <PID> or change PORT environment variable."
        );
        process.exit(1);
      }
      console.error("Server error:", err);
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
