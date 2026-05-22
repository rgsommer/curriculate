// backend/models/EscapeRoomTeamState.js
//
// Per-(roomCode, teamId) state for an active Escape Room session.
// Created lazily when the team first completes a task in an escape-enabled taskset.
//
// All mutations should flow through backend/services/escapeRoom.js — callers
// must not write to this model directly.
import mongoose from "mongoose";

const { Schema } = mongoose;

const EscapeRoomTeamStateSchema = new Schema(
  {
    roomCode:  { type: String, index: true, required: true },
    teamId:    { type: String, required: true },
    tasksetId: { type: Schema.Types.ObjectId, ref: "TaskSet" },

    keysEarned:       { type: [String], default: [] },
    fragmentsEarned:  { type: [String], default: [] },
    locksOpened:      { type: [String], default: [] },
    hintsUsed:        { type: Number, default: 0 },
    narrativeBeatsDelivered: { type: [String], default: [] },

    // Progressive Puzzle Reveal — cached state for the final synthesis puzzle.
    // Shape depends on the final lock's type (cipher-digit / image-tile / etc.)
    finalPuzzleState: { type: Schema.Types.Mixed, default: null },

    startedAt:   { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    escapeTimeMs:{ type: Number, default: null },
  },
  { timestamps: true },
);

EscapeRoomTeamStateSchema.index({ roomCode: 1, teamId: 1 }, { unique: true });

const EscapeRoomTeamState = mongoose.model("EscapeRoomTeamState", EscapeRoomTeamStateSchema);
export default EscapeRoomTeamState;
