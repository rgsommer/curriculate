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
import bodyParser from "body-parser";
import TaskSet from "./models/TaskSet.js";
import TeacherProfile from "./models/TeacherProfile.js";
import SubscriptionPlan from "./models/SubscriptionPlan.js";

import { generateAIScore } from "./ai/aiScoring.js";
import { generateSessionSummaries } from "./ai/sessionSummaries.js";
import { sendTranscriptEmail } from "./email/transcriptEmailer.js";

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://localhost:3000",
  "https://set.curriculate.net",
  "https://play.curriculate.net",
  "https://curriculate.net",
  "https://www.curriculate.net",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(bodyParser.json({ limit: "2mb" }));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
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

// Build a transcript object from a room for analytics + emailing
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
      totalTasks > 0
        ? Math.round((p.attempts / totalTasks) * 100)
        : 0,
    finalPercent:
      p.pointsPossible > 0
        ? Math.round((p.pointsEarned / p.pointsPossible) * 100)
        : 0,
  }));
}

function buildRoomState(room) {
  if (!room) {
    return { teams: {}, stations: {}, scores: {} };
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
      subject: taskset.subject,
      gradeLevel: taskset.gradeLevel,
    });
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

    // NEW: emit `task:launch` (modern contract)
    io.to(code).emit("task:launch", {
      index,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  });

  // --------------------------------------------------------------
  // Student joins room
  // --------------------------------------------------------------
  socket.on("student:joinRoom", (payload, ack) => {
    const { roomCode, teamId, teamName, playerId } = payload || {};
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
    socket.data.teamId = teamId;
    socket.data.playerId = playerId;

    if (!room.teams[teamId]) {
      room.teams[teamId] = {
        teamName,
        members: [],
      };
    }
    room.teams[teamId].members.push(playerId);

    const state = buildRoomState(room);

    io.to(code).emit("team:joined", { teamId, teamName, playerId });

    if (typeof ack === "function") {
      ack({ ok: true, roomState: state });
    }
  });

  // --------------------------------------------------------------
  // Student submits answer
  // --------------------------------------------------------------
  const handleStudentSubmit = async (payload, ack) => {
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
      // If AI returned a numeric totalScore, treat > 0 as "some credit"
      if (aiScore && typeof aiScore.totalScore === "number") {
        return aiScore.totalScore > 0;
      }
      // Fallback: string comparison to correctAnswer if provided
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
//  REST Routes (profile, subscription, AI, etc.)
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

// Teacher profile
app.get("/api/profile/me", async (req, res) => {
  try {
    // For now, just grab the first profile doc
    let profile = await TeacherProfile.findOne().lean();
    if (!profile) {
      profile = await TeacherProfile.create({
        email: "demo@curriculate.net",
        presenterName: "Demo Presenter",
        schoolName: "Demo School",
        perspectives: ["Christian", "Biblical"],
        includeIndividualReports: false,
        assessmentCategories: [
          { label: "Participation", weight: 25 },
          { label: "Understanding", weight: 25 },
          { label: "Application", weight: 25 },
          { label: "Collaboration", weight: 25 },
        ],
      });
    }
    res.json(profile);
  } catch (err) {
    console.error("Profile fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.put("/api/profile/me", async (req, res) => {
  try {
    let profile = await TeacherProfile.findOne();
    if (!profile) {
      profile = new TeacherProfile();
    }

    profile.presenterName = req.body.presenterName ?? profile.presenterName;
    profile.schoolName = req.body.schoolName ?? profile.schoolName;
    profile.email = req.body.email ?? profile.email;
    profile.perspectives = req.body.perspectives ?? profile.perspectives;
    profile.includeIndividualReports =
      req.body.includeIndividualReports ?? profile.includeIndividualReports;
    profile.assessmentCategories =
      req.body.assessmentCategories ?? profile.assessmentCategories;

    await profile.save();
    res.json(profile);
  } catch (err) {
    console.error("Profile update failed:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Subscription info
app.get("/api/subscription/plan", async (req, res) => {
  try {
    let plan = await SubscriptionPlan.findOne().lean();
    if (!plan) {
      plan = await SubscriptionPlan.create({
        tier: "FREE",
        aiTasksetsUsedThisMonth: 0,
      });
    }
    res.json(plan);
  } catch (err) {
    console.error("Subscription fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch subscription plan" });
  }
});

app.post("/api/subscription/ai-usage", async (req, res) => {
  try {
    let plan = await SubscriptionPlan.findOne();
    if (!plan) {
      plan = new SubscriptionPlan({ tier: "FREE" });
    }
    plan.aiTasksetsUsedThisMonth =
      (plan.aiTasksetsUsedThisMonth || 0) + 1;
    await plan.save();
    res.json({ ok: true, aiTasksetsUsedThisMonth: plan.aiTasksetsUsedThisMonth });
  } catch (err) {
    console.error("AI usage update failed:", err);
    res.status(500).json({ error: "Failed to update AI usage" });
  }
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
