import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// try to connect to MongoDB, but don't crash the app if it fails
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.warn("⚠️  MONGO_URI is not set. The app will run, but DB won't be available.");
} else {
  mongoose
    .connect(mongoUri)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => console.error("❌ MongoDB connection error:", err.message));
}

// simple route so we can test Render
app.get("/", (req, res) => {
  res.send("🎉 Curriculate server is running on Render.");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
