// backend/index.js
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/auth.js";
import tasksetRoutes from "./routes/tasksets.js";
import uploadCsvRoutes from "./routes/uploadCsv.js";
import adminRoutes from "./routes/admin.js";

dotenv.config();

// -----------------------------
// Express app setup
// -----------------------------
const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------
// MongoDB connection
// -----------------------------
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
mongoose
  .connect(uri)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) =>
    console.error("❌ MongoDB connection error:", err.message)
  );

// Health check endpoint
app.get("/db-check", (req, res) => {
  const state = mongoose.connection.readyState;
  const map = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  res.json({
    status:
      state === 1 ? "✅ MongoDB connected" : "⚠️ MongoDB not fully connected",
    readyState: state,
    stateText: map[state],
    hasMONGODB_URI: Boolean(process.env.MONGODB_URI),
    hasMONGO_URI: Boolean(process.env.MONGO_URI),
  });
});

// API routes
app.use("/auth", authRoutes);
app.use("/tasksets", tasksetRoutes);
app.use("/upload-csv", uploadCsvRoutes);
app.use("/admin", adminRoutes);

// -----------------------------
// Socket.IO setup
// -----------------------------
const server = http.createServer(app);

// ✅ declare rooms ONCE
const rooms = {}; // { "GRADE8A": { students: [ {id, name} ] } }

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173", // student local
      "http://localhost:5174", // teacher local
      "https://dashboard.curriculate.net",
      "https://play.curriculate.net",
    ],
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("🔌 socket connected:", socket.id);

  socket.on("joinRoom", ({ roomCode, name }) => {
    const code = (roomCode || "").toUpperCase();
    const playerName = name || "Anonymous";

    console.log("👤 joinRoom:", code, playerName);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = playerName;

    // init room
    if (!rooms[code]) {
      rooms[code] = { students: [] };
    }

    // add/update this student
    const existing = rooms[code].students.find((s) => s.id === socket.id);
    if (!existing) {
      rooms[code].students.push({ id: socket.id, name: playerName });
    } else {
      existing.name = playerName;
    }

    // 🔥 tell everyone in that room
    io.to(code).emit("roomRoster", rooms[code].students);
  });

  socket.on("disconnect", () => {
    const code = socket.data?.roomCode;
    if (!code) return;
    if (!rooms[code]) return;

    // remove this student
    rooms[code].students = rooms[code].students.filter(
      (s) => s.id !== socket.id
    );

    // broadcast updated list
    io.to(code).emit("roomRoster", rooms[code].students);
  });

  // you can keep other socket handlers here, e.g. teacherLaunchTask, submitTask, etc.
  socket.on("teacherLaunchTask", ({ roomCode, task }) => {
    io.to(roomCode.toUpperCase()).emit("taskUpdate", task);
  });

  socket.on("teacherSpawnBonus", ({ roomCode, points, durationMs }) => {
    io.to(roomCode.toUpperCase()).emit("bonusEvent", {
      id: "bonus-" + Date.now(),
      points,
      durationMs,
    });
  });
});

// -----------------------------
// Start server
// -----------------------------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () =>
  console.log(`🚀 API + sockets listening on port ${PORT}`)
);
