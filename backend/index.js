// backend/index.js
import 'dotenv/config';
import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server as SocketIOServer } from "socket.io";

import tasksRouter from "./routes/tasks.js";
import tasksetRouter from "./routes/tasksets.js";
import sessionsRouter from "./routes/sessions.js";

import Session from "./models/Session.js";
import TaskSet from "./models/TaskSet.js";
import Submission from "./models/Submission.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import uploadCsvRouter from "./routes/uploadCsv.js";


const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: "*", // tighten later
    methods: ["GET", "POST"],
  },
});

app.set("io", io);

app.use(cors());
app.use(express.json());

// DB health check
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

// ===== SOCKET.IO =====
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Join a session room (host or student)
  socket.on("joinRoom", async ({ code, role, teamId }) => {
    try {
      const upperCode = (code || "").toUpperCase();
      const session = await Session.findOne({ code: upperCode });
      if (!session) {
        socket.emit("room:error", { message: "Session not found" });
        return;
      }

      socket.join(upperCode);
      console.log(`${socket.id} joined room ${upperCode} as ${role}`);

      if (role === "student" && teamId) {
        const team = session.teams.id(teamId);
        if (team) {
          team.currentSocketId = socket.id;
          await session.save();
        }
      }

      io.to(upperCode).emit("room:participantJoined", {
        role,
        teamId: teamId || null,
      });
    } catch (err) {
      console.error("joinRoom error:", err);
      socket.emit("room:error", { message: "Internal error joining room" });
    }
  });

  // Device joins via QR station token
  socket.on("station:joinByToken", async ({ token }) => {
    try {
      const session = await Session.findOne({ "stations.qrToken": token });
      if (!session) {
        socket.emit("station:error", { message: "Invalid station token" });
        return;
      }

      const station = session.stations.find((s) => s.qrToken === token);
      if (!station) {
        socket.emit("station:error", { message: "Invalid station token" });
        return;
      }

      const roomCode = session.code.toUpperCase();

      socket.join(roomCode);
      socket.join(`station:${station._id.toString()}`);

      station.deviceSocketId = socket.id;
      await session.save();

      socket.emit("station:joined", {
        sessionCode: roomCode,
        sessionId: session._id,
        stationId: station._id,
        label: station.label,
        color: station.color,
        currentTeamId: station.currentTeamId || null,
      });

      io.to(roomCode).emit("station:deviceConnected", {
        stationId: station._id,
        label: station.label,
        color: station.color,
      });
    } catch (err) {
      console.error("station:joinByToken error:", err);
      socket.emit("station:error", {
        message: "Internal error joining station",
      });
    }
  });

  // Host starts session
  socket.on("host:startSession", async ({ code }) => {
    try {
      const upperCode = (code || "").toUpperCase();
      const session = await Session.findOne({ code: upperCode });
      if (!session) return;

      const taskSet = await TaskSet.findById(session.taskSet);
      if (!taskSet || !taskSet.tasks || taskSet.tasks.length === 0) return;

      session.state = "running";
      session.currentTaskIndex = 0;
      await session.save();

      const taskIndex = session.currentTaskIndex;
      const task = taskSet.tasks[taskIndex];

      io.to(upperCode).emit("session:started", {
        sessionId: session._id,
        currentTaskIndex: taskIndex,
        task,
        teams: session.teams,
      });
    } catch (err) {
      console.error("host:startSession error:", err);
    }
  });

  // Host moves to next task
  socket.on("host:nextTask", async ({ code }) => {
    try {
      const upperCode = (code || "").toUpperCase();
      const session = await Session.findOne({ code: upperCode });
      if (!session) return;

      const taskSet = await TaskSet.findById(session.taskSet);
      if (!taskSet) return;

      const tasks = taskSet.tasks || [];
      const taskCount = tasks.length;

      if (session.currentTaskIndex + 1 >= taskCount) {
        session.state = "finished";
        await session.save();
        io.to(upperCode).emit("session:finished", {
          sessionId: session._id,
          teams: session.teams,
        });
        return;
      }

      session.currentTaskIndex += 1;
      await session.save();

      const taskIndex = session.currentTaskIndex;
      const task = tasks[taskIndex];

      io.to(upperCode).emit("task:started", {
        sessionId: session._id,
        currentTaskIndex: taskIndex,
        task,
      });
    } catch (err) {
      console.error("host:nextTask error:", err);
    }
  });

  // Student submission via socket
  // payload: { code, teamId, taskIndex, answer, responseTimeMs }
  socket.on(
    "student:submitAnswer",
    async ({ code, teamId, taskIndex, answer, responseTimeMs }) => {
      try {
        const upperCode = (code || "").toUpperCase();
        const session = await Session.findOne({ code: upperCode });
        if (!session) {
          socket.emit("submission:error", { message: "Session not found" });
          return;
        }

        const taskSet = await TaskSet.findById(session.taskSet);
        if (!taskSet) {
          socket.emit("submission:error", { message: "TaskSet not found" });
          return;
        }

        const tasks = taskSet.tasks || [];
        const idx = Number(taskIndex);
        if (Number.isNaN(idx) || idx < 0 || idx >= tasks.length) {
          socket.emit("submission:error", { message: "Invalid taskIndex" });
          return;
        }

        const task = tasks[idx];
        const correctAnswerVal =
          task.correctAnswer != null ? task.correctAnswer.toString().trim() : "";
        const isCorrect =
          (answer || "").toString().trim() === correctAnswerVal;

        let submission;
        try {
          submission = await Submission.create({
            session: session._id,
            taskIndex: idx,
            teamId,
            answer,
            isCorrect,
            responseTimeMs,
          });
        } catch (err) {
          if (err.code === 11000) {
            socket.emit("submission:error", {
              message: "Already submitted for this task",
            });
            return;
          }
          throw err;
        }

        const submissionsCount = await Submission.countDocuments({
          session: session._id,
          taskIndex: idx,
        });

        io.to(upperCode).emit("submission:received", {
          teamId,
          isCorrect,
          taskIndex: idx,
          submissionsCount,
        });
      } catch (err) {
        console.error("student:submitAnswer error:", err);
        socket.emit("submission:error", { message: "Internal error" });
      }
    }
  );

  // Host scores a task via socket
  // payload: { code, taskIndex }
  socket.on("host:scoreTask", async ({ code, taskIndex }) => {
    try {
      const upperCode = (code || "").toUpperCase();
      const session = await Session.findOne({ code: upperCode });
      if (!session) return;

      const idx = Number(taskIndex);
      if (Number.isNaN(idx)) return;

      const submissions = await Submission.find({
        session: session._id,
        taskIndex: idx,
      });

      // Use pure scoring util to compute adds and update session teams
      try {
        const { computeScores } = await import("./lib/scoring.js");
        const { scoresToAdd } = computeScores(session, submissions);

        session.teams.forEach((team) => {
          const key = team._id.toString();
          const add = scoresToAdd[key] || 0;
          team.score += add;
        });

        await session.save();

        io.to(upperCode).emit("scores:updated", {
          taskIndex: idx,
          teams: session.teams,
          scoresAdded: scoresToAdd,
        });
      } catch (err) {
        console.error("scoreTask compute error:", err);
      }
    } catch (err) {
      console.error("host:scoreTask error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // later: clear station.deviceSocketId or team.currentSocketId if needed
  });
});

// ===== START SERVER + DB =====
const PORT = process.env.PORT || 4000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/curriculate";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
