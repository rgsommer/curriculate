import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// grab from either name
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

// 1) fail immediately if no URI
if (!uri) {
  console.error("❌ No Mongo URI found. Set MONGODB_URI or MONGO_URI in Render.");
}

mongoose
  .connect(uri)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });

app.get("/db-check", (req, res) => {
  const state = mongoose.connection.readyState;
  const map = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    status: state === 1 ? "✅ MongoDB connected" : "⚠️ MongoDB not fully connected",
    readyState: state,
    stateText: map[state],
    // this line helps you see which env var name is actually populated
    hasMONGODB_URI: Boolean(process.env.MONGODB_URI),
    hasMONGO_URI: Boolean(process.env.MONGO_URI),
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 API listening on port", PORT));
