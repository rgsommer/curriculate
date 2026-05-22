// backend/models/MysterySession.js
//
// Per-room runtime state for the Whodunnit overlay. Created when a teacher
// enables the mystery layer via the `mystery:enable` socket. The suspect's
// identity is stored here — the server is the ONLY place it lives. Non-suspect
// clients NEVER receive it.
//
// See WHODUNNIT_PLAN.md §3a for the full data model.
import mongoose from "mongoose";

const { Schema } = mongoose;

const ClueRefSchema = new Schema(
  {
    id: String,
    type: { type: String, enum: ["movement", "identity", "team", "visual", "inventory", "timing"], default: "movement" },
    text: String,
    sourceEvent: { type: Schema.Types.Mixed, default: null },
    truth: { type: Boolean, default: true },
    ambiguityCount: { type: Number, default: 0 },
    releasedAt: { type: Date, default: Date.now },
    releasedBy: { type: String, default: "auto" },     // "auto" | "teacher" | "team-purchase"
  },
  { _id: false },
);

const AccusationSchema = new Schema(
  {
    teamId: String,
    accusedPlayerId: String,
    correct: Boolean,
    ts: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MysterySessionSchema = new Schema(
  {
    roomCode:   { type: String, index: true, unique: true, required: true },
    enabled:    { type: Boolean, default: true },
    themeRole:  { type: String, enum: ["spy", "saboteur", "infiltrator", "smuggler", "double-agent"], default: "spy" },
    difficulty: { type: String, enum: ["easy", "medium", "hard", "expert"], default: "medium" },

    suspectPlayerId:  { type: String, required: true },
    suspectAssignedAt:{ type: Date, default: Date.now },

    cluesReleasedAutomatically: { type: Boolean, default: true },
    autoClueIntervalMs:         { type: Number,  default: 90 * 1000 },

    investigationEconomy: {
      cluePurchaseCost:      { type: Number, default: 20 },
      revealNamePartCost:    { type: Number, default: 30 },
      revealMovementCost:    { type: Number, default: 20 },
      revealInventoryCost:   { type: Number, default: 25 },
    },
    accusationConfig: {
      accusationCost:         { type: Number, default: 50 },
      correctReward:          { type: Number, default: 200 },
      wrongPenalty:           { type: Number, default: 30 },
      maxAccusationsPerTeam:  { type: Number, default: 2 },
      accusationCooldownMs:   { type: Number, default: 5 * 60 * 1000 },
    },

    cluesReleased:        { type: [ClueRefSchema], default: [] },
    cluesPurchasedByTeam: { type: Map, of: [ClueRefSchema], default: () => new Map() },
    accusations:          { type: [AccusationSchema], default: [] },

    endedAt: { type: Date, default: null },
    ended:   { type: Boolean, default: false },
  },
  { timestamps: true },
);

const MysterySession = mongoose.model("MysterySession", MysterySessionSchema);
export default MysterySession;
