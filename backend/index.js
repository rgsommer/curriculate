import http from "http";
import { Server } from "socket.io";
import express from "express";
// ... your existing imports

const app = express();
// ... your middleware

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://dashboard.curriculate.net", "https://play.curriculate.net"], methods: ["GET","POST"] }
});

// in-memory sessions for now
const liveSessions = new Map(); // roomCode -> { taskSetId, scores: {socketId: {name, score}}, activeBonuses: {} }

io.on("connection", (socket) => {
  console.log("student/teacher connected", socket.id);

  // student joins room
  socket.on("joinRoom", ({ roomCode, name }) => {
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.name = name;
    if (!liveSessions.has(roomCode)) {
      liveSessions.set(roomCode, { scores: {}, activeBonuses: {} });
    }
    // send current scores
    const session = liveSessions.get(roomCode);
    socket.emit("leaderboardUpdate", session.scores);
  });

  // teacher broadcasts current task
  socket.on("teacherLaunchTask", ({ roomCode, task }) => {
    io.to(roomCode).emit("taskUpdate", task);
  });

  // student submits
  socket.on("submitTask", ({ roomCode, correct, elapsedMs, basePoints = 10 }) => {
    const session = liveSessions.get(roomCode);
    if (!session) return;
    const name = socket.data.name || socket.id;

    let awarded = correct ? basePoints : 0;
    // timed bonus
    if (correct && elapsedMs != null) {
      // simple example: +5 if under 5 seconds
      if (elapsedMs < 5000) awarded += 5;
    }

    session.scores[name] = (session.scores[name] || 0) + awarded;
    io.to(roomCode).emit("leaderboardUpdate", session.scores);
  });

  // bonus event
  socket.on("teacherSpawnBonus", ({ roomCode, points = 5, durationMs = 8000 }) => {
    const session = liveSessions.get(roomCode);
    if (!session) return;
    const bonusId = "bonus-" + Date.now();
    session.activeBonuses[bonusId] = { points, expiresAt: Date.now() + durationMs };
    io.to(roomCode).emit("bonusEvent", { id: bonusId, points, durationMs });
  });

  socket.on("claimBonus", ({ roomCode, bonusId }) => {
    const session = liveSessions.get(roomCode);
    if (!session) return;
    const bonus = session.activeBonuses[bonusId];
    if (!bonus) return;

    const name = socket.data.name || socket.id;
    session.scores[name] = (session.scores[name] || 0) + bonus.points;

    delete session.activeBonuses[bonusId];
    io.to(roomCode).emit("leaderboardUpdate", session.scores);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🚀 API + sockets listening on", PORT));
