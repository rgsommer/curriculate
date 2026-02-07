// backend/models/Session.js
import mongoose from "mongoose";

const { Schema, models, model } = mongoose;

// --- TEAM SUBDOC ---
const TeamSchema = new Schema(
  {
    name: { type: String, required: true },   // e.g. "Blue Lightning"
    color: { type: String },                  // e.g. "#1e88e5" or "blue"
    members: [{ type: String }],             // optional: ["Alice", "Bob"]
    score: { type: Number, default: 0 },
    currentSocketId: { type: String },       // used in index.js
  },
  { _id: true }
);

// --- STATION SUBDOC --- (colour stations with QR codes)
const StationSchema = new Schema(
  {
    label: { type: String, required: true },  // "Station 1"
    color: { type: String },                  // visual colour
    qrToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,                            // used in station:joinByToken
    },
    deviceSocketId: { type: String },
    currentTeamId: { type: Schema.Types.ObjectId }, // _id of Team subdoc
  },
  { _id: true }
);

// --- SESSION ---
const SessionSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      unique: true,                           // joinRoom uses this
      index: true,
    },
    hostId: { type: String },                 // optional: teacher/user id
    taskSet: {
      type: Schema.Types.ObjectId,
      ref: "TaskSet",
      required: true,
    },
    state: {
      type: String,
      enum: ["lobby", "running", "finished"],
      default: "lobby",
    },
    currentTaskIndex: { type: Number, default: -1 },

    teams: [TeamSchema],
    stations: [StationSchema],
  },
  { timestamps: true }
);

const Session = models.Session || model("Session", SessionSchema);
export default Session;
