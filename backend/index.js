// backend/index.js
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config(); // Load .env if running locally

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// --------------------
//  MONGODB CONNECTION
// --------------------
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!uri) {
  console.error("❌ No Mongo URI found in environment variables.");
  process.exit(1);
}

mongoose
  .connect(uri)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

// --------------------
//  BASIC ROUTES
// --------------------

// Health check endpoint for Render
app.get("/db-check", (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const statusMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  res.json({
    status:
      mongoStatus === 1
        ? "✅ MongoDB connected"
        : "⚠️ MongoDB not fully connected",
    readyState: mongoStatus,
    stateText: statusMap[mongoStatus],
  });
});

// Example: simple root route
app.get("/", (req, res) => {
  res.send("Curriculate API is running ✅");
});

// Example: tasks route placeholder
// You can import routes from /routes/tasks.js later
// import tasksRouter from "./routes/tasks.js";
// app.use("/tasks", tasksRouter);

// --------------------
//  SERVER START
// --------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 API listening on port ${PORT}`);
});
