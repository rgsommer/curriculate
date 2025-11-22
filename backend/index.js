// ====================================================================
//  Curriculate Backend – Clean, Modern, Rewritten Index.js
//  Supports:
//   - Rooms, Sessions, Teams, Stations
//   - Station Location Protection (Classroom/Hallway/etc.)
//   - Task Launching + Student Submissions
//   - AI Rubric Scoring + AI Session Summaries
//   - Perspectives (multi-select worldview/approach tags)
//   - PDF + HTML Transcript Emailing
// ====================================================================

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

// --------------------------------------------------------------------
// App + Server Setup
// --------------------------------------------------------------------
const app = express();
app.use(express.json());

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// --------------------------------------------------------------------
// MongoDB Connection
// --------------------------------------------------------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("Mongo connected"))
.catch(err => console.error("Mongo connection error:", err));

// ====================================================================
//  ROOM ENGINE (All In-Memory)
// ====================================================================
const rooms = {};  // rooms["8A"] = { teacherSocketId, teams, tasks, ... }

// Create a blank room object
function createRoom(roomCode, teacherSocketId) {
  return {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
    teams: {},            // teamId -> { teamName, color, members: [] }
    stations: {},         // color -> { roomLocation }
    taskset: null,
    taskIndex: -1,
    submissions: [],
    startedAt: null,
    isActive: false,
  };
}

// Build transcript JSON for email + AI
function buildTranscript(room) {
  const taskset = room.taskset;
  const tasks = taskset.tasks || [];

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
    const pts = (() => {
      if (sub.aiScore && typeof sub.aiScore.totalScore === "number")
        return sub.aiScore.totalScore;
      return sub.correct ? (sub.points ?? 0) : 0;
    })();
    teamScores[sub.teamName] = (teamScores[sub.teamName] || 0) + pts;
  }

  const totalPossible = taskRecords.reduce((s, t) => s + (t.points ?? 10), 0);

  return {
    roomCode: room.code,
    tasksetName: taskset.name,
    tasks: taskRecords,
    totalPossible,
    scores: teamScores,
    submissions: room.submissions,
  };
}

// Build per-participant stats for AI summaries
function computePerParticipantStats(room, transcript) {
  const tasks = transcript.tasks || [];
  const tasksByIndex = {};
  tasks.forEach(t => tasksByIndex[t.index] = t);

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

    const task = tasksByIndex[sub.taskIndex] || null;
    const taskPoints = task?.points ?? 10;

    if (sub.correct) entry.correctCount += 1;

    const earned = sub.aiScore?.totalScore ??
                   (sub.correct ? taskPoints : 0);

    entry.pointsEarned += earned;
    entry.pointsPossible += taskPoints;
  }

  const totalTasks = tasks.length;

  return Object.values(participants).map(p => ({
    ...p,
    engagementPercent: totalTasks > 0
      ? Math.round(p.attempts / totalTasks * 100)
      : 0,
    finalPercent: p.pointsPossible > 0
      ? Math.round(p.pointsEarned / p.pointsPossible * 100)
      : 0,
  }));
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
  // Teacher loads a taskset
  // --------------------------------------------------------------
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
  });

  // --------------------------------------------------------------
  // Teacher starts session
  // --------------------------------------------------------------
  socket.on("teacher:startSession", ({ roomCode }) => {
    const room = rooms[(roomCode || "").toUpperCase()];
    if (!room) return;

    room.startedAt = Date.now();
    room.isActive = true;
    room.taskIndex = -1;

    io.to(roomCode).emit("session:started");
  });

  // --------------------------------------------------------------
  // Teacher send next task
  // --------------------------------------------------------------
  socket.on("teacher:nextTask", ({ roomCode }) => {
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
  });

  // --------------------------------------------------------------
  // Student joins room
  // --------------------------------------------------------------
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
        teamName,
        members: [],
      };
    }
    room.teams[teamId].members.push(playerId);

    io.to(code).emit("team:joined", { teamId, teamName, playerId });
  });

  // --------------------------------------------------------------
  // Student submits answer
  // --------------------------------------------------------------
  socket.on("task:submit", async (payload) => {
    const {
      roomCode,
      teamId,
      teamName,
      playerId,
      taskIndex,
      answer,
    } = payload;

    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const task = room.taskset.tasks[taskIndex];
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

    const correct = (() => {
      if (aiScore && typeof aiScore.totalScore === "number") {
        return aiScore.totalScore > 0;
      }
      if (task.correctAnswer == null) return null;
      return String(answer).trim() === String(task.correctAnswer).trim();
    })();

    room.submissions.push({
      roomCode: code,
      teamId,
      teamName,
      playerId,
      taskIndex,
      answer,
      correct,
      points: task.points ?? 10,
      aiScore,
      submittedAt: Date.now(),
    });

    socket.emit("task:received");
  });

  // --------------------------------------------------------------
  // Teacher ends session + sends transcript
  // --------------------------------------------------------------
  socket.on("teacher:endSessionAndEmail", async ({
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
      socket.emit("transcript:error", { message: "Teacher email missing" });
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
      console.error("Transcript error:", err);
      socket.emit("transcript:error", { message: "Failed to generate transcript." });
    }
  });

});

// ====================================================================
// EXPRESS ROUTES (Profile + TaskSets)
// ====================================================================

// Get teacher profile
app.get("/api/profile", async (req, res) => {
  let p = await Profile.findOne();
  if (!p) {
    p = new Profile();
    await p.save();
  }
  res.json(p);
});

// Update teacher profile
app.put("/api/profile", async (req, res) => {
  let p = await Profile.findOne();
  if (!p) p = new Profile();
  Object.assign(p, req.body);
  await p.save();
  res.json({ ok: true });
});

// Get tasksets
app.get("/api/tasksets", async (req, res) => {
  const sets = await TaskSet.find().sort({ createdAt: -1 }).lean();
  res.json(sets);
});

// Save taskset (new or update)
app.put("/api/tasksets/:id", async (req, res) => {
  await TaskSet.findByIdAndUpdate(req.params.id, req.body);
  res.json({ ok: true });
});

// Create taskset
app.post("/api/tasksets", async (req, res) => {
  const t = new TaskSet(req.body);
  await t.save();
  res.json(t);
});

// ====================================================================
//  Start Server
// ====================================================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
});
