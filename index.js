import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Simple route
app.get("/", (req, res) => {
  res.send("🎉 Curriculate server is running and connected to MongoDB!");
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
