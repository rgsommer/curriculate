// backend/models/TruthOrDareSession.js
//
// Per-room runtime state for a Truth-or-Dare session. Created either when a
// teacher launches a standalone Truth-or-Dare task or when the overlay
// injection engine starts a mid-taskset T-or-D round.
//
// See TRUTH_OR_DARE_PLAN.md §7 (Database Schemas) for the full data model.

import mongoose from "mongoose";

const { Schema } = mongoose;

const TruthOrDareSessionSchema = new Schema(
  {
    roomCode:   { type: String, index: true, required: true },
    tasksetId:  { type: Schema.Types.ObjectId, ref: "TaskSet", default: null },
    taskIndex:  { type: Number, default: null },          // null if overlay

    mode: {
      type: String,
      enum: [
        "individual", "team", "duel", "lightning", "historical-roleplay",
        "debate-dare", "mystery-spy", "whole-class", "teacher-injection",
        "silent", "stationary", "movement",
      ],
      default: "individual",
    },

    startedAt: { type: Date, default: Date.now },
    endedAt:   { type: Date, default: null },

    // Per-session config snapshot — captured at start time so mid-session
    // teacher edits don't retroactively affect logged rounds.
    config: {
      physicalIntensityMax:    { type: Number,  default: 2 },
      socialIntensityMax:      { type: Number,  default: 2 },
      movementAllowed:         { type: Boolean, default: true },
      noiseAllowed:            { type: Boolean, default: true },
      safeClassroomMode:       { type: Boolean, default: false },
      cameraEnabled:           { type: Boolean, default: false },
      micEnabled:              { type: Boolean, default: true },
      injectionFrequencyMin:   { type: Number,  default: 10 },
      maxInjectionsPerSession: { type: Number,  default: 3 },
      gradeBand:               { type: String,  default: "" },
      worldview:               { type: String,  default: "general" },
      subject:                 { type: String,  default: "" },
      unitName:                { type: String,  default: "" },
      gradeLevel:              { type: Number,  default: 7 },
      tierProgression:         { type: String,  enum: ["linear", "random"], default: "linear" },
      judgmentMode:            { type: String,  enum: ["teacher", "class-vote", "mixed"], default: "teacher" },
    },

    rounds:      [{ type: Schema.Types.ObjectId, ref: "TruthOrDareRound" }],
    totalRounds: { type: Number, default: 0 },

    // Per-team mutable counters — used by the orchestrator. Map values
    // chosen to be lightweight (number) so the doc stays cheap to update.
    passesUsed:  { type: Map, of: Number, default: () => new Map() }, // teamId → count
    cooldownsBy: { type: Map, of: Number, default: () => new Map() }, // teamId → unlockAt round
    tierByTeam:  { type: Map, of: String, default: () => new Map() }, // teamId → "sprout"|"stem"|"big"
    successesByTeam: { type: Map, of: Number, default: () => new Map() }, // teamId → consecutive successes

    // Aggregate counters
    flaggedRoundsCount: { type: Number, default: 0 },
    libraryFallbackCount: { type: Number, default: 0 },
    moderationRetryCount: { type: Number, default: 0 },

    ended: { type: Boolean, default: false },
  },
  { timestamps: true },
);

TruthOrDareSessionSchema.index({ roomCode: 1, startedAt: -1 });

const TruthOrDareSession = mongoose.model("TruthOrDareSession", TruthOrDareSessionSchema);
export default TruthOrDareSession;
