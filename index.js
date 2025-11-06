import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 1) connect to MongoDB (but don't crash app if it fails)
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.warn("⚠️  MONGO_URI is not set. The app will run, but DB won't be available.");
} else {
  mongoose
    .connect(mongoUri)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => console.error("❌ MongoDB connection error:", err.message));
}

// root route
app.get("/", (req, res) => {
  res.send("🎉 Curriculate server is running on Render.");
});

// 2) simple DB-check route
app.get("/db-check", async (req, res) => {
  const state = mongoose.connection.readyState;
  // 1 = connected, 2 = connecting, 0 = disconnected
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

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
