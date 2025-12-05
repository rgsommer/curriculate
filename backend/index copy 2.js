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
import aiGenerate from "./routes/ai-generate.js";
import voiceRoutes from "./routes/voice.js";
import speechRoutes from "./routes/speech.js";

// Station colours
const COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "teal", "pink"];

// Simple UUID generator
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

//const raceWinner = {};
const teamClues = new Map(); // ← global store for mystery clues
const flashcardStates = new Map(); // ← flashcards race state
const diffRaceStates = new Map(); // ← diff detective race state

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
    targetRoom.teams[teamId].score = (targetRoom.teams[teamId].score || 0) + points;
  }
}

function getRandomTeam(roomCode) {
  const room = rooms[roomCode];
  const teams = Object.values(room?.teams || {});
  if (teams.length === 0) return null;
  return teams[Math.floor(Math.random() * teams.length)];
}

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost/curriculate", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Middleware
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/ai", aiGenerate); // AI generation routes (diff, pronunciation, etc.)
app.use("/api/voice", voiceRoutes); // Voice cloning routes
app.use("/api/speech", speechRoutes); // Speech/Whisper routes

// Socket.io handlers
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join-room", ({ roomCode, teamId, playerName }) => {
    const code = roomCode.toUpperCase();
    socket.join(code);
    socket.roomCode = code;
    socket.teamId = teamId;

    const room = rooms[code];
    if (room && room.teams[teamId]) {
      room.teams[teamId].players = room.teams[teamId].players || [];
      room.teams[teamId].players.push({ id: socket.id, name: playerName });
      io.to(code).emit("team-update", room.teams);
    }
  });

  socket.on("start-session", ({ roomCode, taskSetId, mode = "race" }) => {
    const code = roomCode.toUpperCase();
    TaskSet.findById(taskSetId).then((taskSet) => {
      if (!taskSet) return socket.emit("error", "Task set not found");

      rooms[code] = {
        teacherSocket: socket.id,
        teams: {},
        stations: taskSet.tasks.map((task, i) => ({
          id: generateUUID(),
          name: task.title || `Station ${i + 1}`,
          task,
          color: COLORS[i % COLORS.length],
        })),
        tasks: taskSet.tasks,
        mode,
      };

      io.to(code).emit("session-started", rooms[code]);
    });
  });

  socket.on("create-team", ({ roomCode, teamName }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (room) {
      const teamId = generateUUID();
      room.teams[teamId] = { name: teamName, players: [], score: 0, tasksCompleted: 0, totalResponseTime: 0, perfectTasks: 0 };
      io.to(code).emit("team-created", room.teams[teamId]);
    }
  });

  socket.on("submit-answer", async ({ roomCode, teamId, stationId, answer }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const station = room.stations.find(s => s.id === stationId);
    if (!station) return;

    const task = station.task;
    const points = task.points || 10;

    let isCorrect = false;
    if (task.correctAnswer) {
      isCorrect = answer === task.correctAnswer;
    } else {
      // AI scoring for open-ended tasks
      const scoreResult = await generateAIScore({ task, submission: { answerText: answer } });
      isCorrect = scoreResult.totalScore >= (points / 2); // Partial credit threshold
    }

    updateTeamScore(room, teamId, isCorrect ? points : 0);

    io.to(code).emit("answer-submitted", { teamId, stationId, isCorrect });
  });

  socket.on("lightning-start", ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.lightningInterval = setInterval(() => {
      const team = getRandomTeam(code);
      if (team) {
        updateTeamScore(room, team.id, -5); // Penalty for slow team
        io.to(code).emit("lightning-strike", { teamId: team.id });
      }
    }, 30000); // Every 30 seconds
  });

  socket.on("mystery-clue", ({ roomCode, teamId, clue }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room || !room.teams[teamId]) return;

    const teamCluesKey = `${code}-${teamId}`;
    const clues = teamClues.get(teamCluesKey) || [];
    clues.push(clue);
    teamClues.set(teamCluesKey, clues);

    if (clues.length >= room.tasks.length) {
      io.to(code).emit("mystery-complete", { teamId, clues });
    }
  });

  // Flashcards Inter-Team Race
  socket.on("flashcards:start", ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    const session = rooms[code];
    if (!session) return;

    flashcardStates.set(code, {
      currentCard: 0,
      winner: null,
      teamScores: { A: 0, B: 0 },
    });

    io.to(code).emit("flashcards:start", { cardIndex: 0 });
  });

  socket.on("flashcard:answer", ({ roomCode, cardIndex, team, spoken, correct }) => {
    const code = roomCode.toUpperCase();
    const state = flashcardStates.get(code);
    if (!state || state.currentCard !== cardIndex || state.winner) return;

    if (correct) {
      state.winner = team;
      state.teamScores[team] += 10;
      flashcardStates.set(code, state);

      io.to(code).emit("flashcard:winner", { team, points: 10 });

      setTimeout(() => {
        const next = cardIndex + 1;
        const cards = session.taskSet.tasks.find(t => t.task_type === "flashcards")?.cards || [];
        if (next < cards.length) {
          state.currentCard = next;
          state.winner = null;
          flashcardStates.set(code, state);
          io.to(code).emit("flashcard:next", { cardIndex: next });
        } else {
          io.to(code).emit("flashcards:complete", { finalScores: state.teamScores });
        }
      }, 3000);
    }
  });

  // Diff Detective Race
  socket.on("diff:race-start", ({ roomCode, taskIndex }) => {
    const code = roomCode.toUpperCase();
    const session = rooms[code];
    if (!session) return;

    diffRaceStates.set(code, {
      taskIndex,
      startTime: Date.now(),
      duration: 90000,
      submissions: {},
      teamScores: { A: 0, B: 0 },
    });

    io.to(code).emit("diff:race-start", { timeLeft: 90 });

    const timer = setInterval(() => {
      const state = diffRaceStates.get(code);
      if (!state) { clearInterval(timer); return; }
      const elapsed = Date.now() - state.startTime;
      const left = Math.max(0, 90 - Math.floor(elapsed / 1000));
      io.to(code).emit("diff:race-tick", { timeLeft: left });
      if (left <= 0) {
        clearInterval(timer);
        io.to(code).emit("diff:race-end", { finalScores: state.teamScores });
      }
    }, 1000);
  });

  socket.on("diff:submit", async ({ roomCode, answer, team }) => {
    const code = roomCode.toUpperCase();
    const state = diffRaceStates.get(code);
    if (!state) return;

    const task = session.taskSet.tasks[taskIndex];
    const scoreResult = await generateAIScore({ task, submission: { answerText: answer } });

    if (scoreResult.totalScore > 0) {
      state.submissions[socket.id] = { team, score: scoreResult.totalScore };
      state.teamScores[team] += scoreResult.totalScore;
      diffRaceStates.set(code, state);

      io.to(code).emit("diff:race-update", { scores: state.teamScores, latest: { team, points: scoreResult.totalScore } });
    }
  });

  // Pronunciation Submit
  socket.on("pronunciation:submit", async ({ roomCode, audioUrl, referenceText, targetAccent, language }) => {
    const code = roomCode.toUpperCase();
    const task = rooms[code].currentTask;

    const scoreResult = await generateAIScore({
      task: { ...task, referenceText, language, targetAccent },
      submission: { audioUrl },
    });

    io.to(socket.id).emit("pronunciation:score", scoreResult);
  });

  // Speech Recognition Submit
  socket.on("speech-recognition:submit", async ({ roomCode, spokenText, referenceText, language }) => {
    const code = roomCode.toUpperCase();
    const task = rooms[code].currentTask;

    const scoreResult = await generateAIScore({
      task: { ...task, referenceText, language },
      submission: { spokenText },
    });

    io.to(socket.id).emit("speech-recognition:score", scoreResult);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    if (socket.roomCode && socket.teamId) {
      const room = rooms[socket.roomCode];
      if (room && room.teams[socket.teamId]) {
        room.teams[socket.teamId].players = room.teams[socket.teamId].players.filter(p => p.id !== socket.id);
        io.to(socket.roomCode).emit("team-update", room.teams[socket.teamId]);
      }
    }
  });
});

// Public routes
app.get("/api/tasksets", async (req, res) => {
  try {
    const tasksets = await TaskSet.find({ isPublic: true }).select("name description createdAt").lean();
    res.json(tasksets);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tasksets" });
  }
});

app.post("/api/sessions/create", authRequired, async (req, res) => {
  try {
    const { taskSetId, teamCount = 4, mode = "race" } = req.body;
    const taskSet = await TaskSet.findById(taskSetId);
    if (!taskSet) return res.status(404).json({ error: "Task set not found" });

    const roomCode = generateUUID().slice(0, 6).toUpperCase();
    const teams = Array.from({ length: teamCount }, (_, i) => ({
      id: generateUUID(),
      name: `Team ${String.fromCharCode(65 + i)}`,
      players: [],
      score: 0,
      tasksCompleted: 0,
      totalResponseTime: 0,
      perfectTasks: 0
    }));

    const session = new Session({
      roomCode,
      teacherId: req.userId,
      taskSet: taskSet._id,
      teams,
      mode,
      startedAt: new Date(),
    });

    await session.save();

    res.json({ roomCode });
  } catch (err) {
    console.error("Create session error:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// Protected routes (authRequired)
app.get("/api/tasksets/mine", authRequired, async (req, res) => {
  try {
    const tasksets = await TaskSet.find({ ownerId: req.userId }).lean();
    res.json(tasksets);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch your tasksets" });
  }
});

app.post("/api/tasksets", authRequired, async (req, res) => {
  try {
    const taskset = new TaskSet({ ...req.body, ownerId: req.userId });
    await taskset.save();
    res.json(taskset);
  } catch (err) {
    res.status(500).json({ error: "Failed to create taskset" });
  }
});

app.put("/api/tasksets/:id", authRequired, async (req, res) => {
  try {
    const updated = await TaskSet.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.userId },
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
    if (!session) return res.status(404).json({ error: "Session not found" });

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