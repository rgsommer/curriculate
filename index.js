import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// so we can read JSON bodies
app.use(express.json());

// ================================
// 1) MONGODB CONNECTION
// ================================
const mongoUri = process.env.MONGO_URI;
let lastMongoError = null;

if (!mongoUri) {
  console.warn("⚠️  MONGO_URI is not set. App will run but DB won't be available.");
} else {
  console.log("🔌 Attempting MongoDB connection...");
  mongoose
    .connect(mongoUri)
    .then(() => {
      console.log("✅ Connected to MongoDB Atlas");
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err.message);
      lastMongoError = err.message;
    });

  // listen for any later errors
  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB runtime error:", err.message);
    lastMongoError = err.message;
  });
}

// ================================
// 2) SIMPLE TASK MODEL (inline)
// ================================
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    points: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const Task =
  mongoose.models.Task || mongoose.model("Task", taskSchema);

// ================================
// 3) ROUTES
// ================================

// root route
app.get("/", (req, res) => {
  res.send("🎉 Curriculate server is running on Render.");
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
    lastError: lastMongoError,
  });
});

// create a task
app.post("/tasks", async (req, res) => {
  try {
    // if DB isn't ready, short-circuit
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const task = await Task.create(req.body);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// list tasks
app.get("/tasks", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const tasks = await Task.find().sort({ createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================
// 4) START SERVER
// ================================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
