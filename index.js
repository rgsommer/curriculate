import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const mongoUri = process.env.MONGO_URI;

let lastMongoError = null;

if (!mongoUri) {
  console.warn("⚠️  MONGO_URI is not set.");
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

  // also listen for later errors
  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB runtime error:", err.message);
    lastMongoError = err.message;
  });
}

app.get("/", (req, res) => {
  res.send("🎉 Curriculate server is running on Render.");
});

// existing check
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

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
