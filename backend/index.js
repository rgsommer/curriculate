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
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// Health check endpoint
app.get("/db-check", (req, res) => {
  const state = mongoose.connection.readyState;
  const map = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    status: state === 1 ? "✅ MongoDB connected" : "⚠️ MongoDB not fully connected",
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
const io = new Server(server, {
  cors: {
    origin: ["https://dashboard.curriculate.net", "https://play.curriculate.net"],
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("🔌 connected:", socket.id);

  socket.on("joinRoom", ({ roomCode, name }) => {
    socket.join(roomCode);
    socket.data.name = name;
    console.log(`${name} joined ${roomCode}`);
  });

  // add other socket events here (teacherLaunchTask, submitTask, etc.)
});

// -----------------------------
// Start server
// -----------------------------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 API + sockets listening on port ${PORT}`));
