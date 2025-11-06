import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import tasksRouter from "./routes/tasks.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// connect to Mongo
const mongoUri = process.env.MONGO_URI;
let lastMongoError = null;

mongoose
  .connect(mongoUri)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    lastMongoError = err.message;
  });

// basic routes
app.get("/", (req, res) => {
  res.send("🎉 Curriculate server is running on Render.");
});

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

// 👇 this is where all your earlier code plugs in
app.use("/tasks", tasksRouter);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
