// backend/models/TeamSession.js
import mongoose from "mongoose";

const teamSessionSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, index: true },
  teamName: { type: String, required: true },
  teamColor: { type: String, required: true },
  playerNames: [String],
  status: { type: String, enum: ["online", "offline"], default: "online" },
  lastSeenAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// Optional: auto-delete after 24h regardless (extra safety)
teamSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.models.TeamSession
  ? mongoose.models.TeamSession
  : mongoose.model("TeamSession", teamSessionSchema);