// backend/models/Session.js
import mongoose from "mongoose";

const studentScoreSchema = new mongoose.Schema({
  studentId: String,    // socket id or temp id
  name: String,
  score: { type: Number, default: 0 },
});

const sessionSchema = new mongoose.Schema(
  {
    roomCode: { type: String, unique: true },
    taskSet: { type: mongoose.Schema.Types.ObjectId, ref: "TaskSet" },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    scores: [studentScoreSchema],
    status: { type: String, enum: ["waiting", "running", "ended"], default: "waiting" }
  },
  { timestamps: true }
);

export default mongoose.model("Session", sessionSchema);
