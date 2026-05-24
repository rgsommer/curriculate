// backend/models/TeamQuestState.js
//
// Per-(roomCode, teamId) persistent state for Quest Mode overlays.
// Created lazily on first task completion in a quest-enabled room.
//
// Coin/inventory updates flow through `backend/services/questEconomy.js` —
// callers should NOT mutate this model directly.

import mongoose from "mongoose";

const { Schema } = mongoose;

const TradeRecordSchema = new Schema(
  {
    id: String,
    sellerTeamId: String,
    buyerTeamId: String,
    resourceId: String,
    quantity: Number,
    price: Number,
    acquisitionMethod: String,
    approvedBy: String,
    qrToken: String,
    scannedAt: Date,
    contributionTags: { type: [Schema.Types.Mixed], default: [] },
    sellerPointsAwarded: Number,
    buyerPointsAwarded: Number,
  },
  { _id: false },
);

const ContributionRecordSchema = new Schema(
  {
    interactionId: String,
    teamId: String,
    studentId: String,
    role: String,
    tags: { type: [String], default: [] },
    optionalRating: Number,
    evidenceText: String,
    awardedPoints: Number,
    ts: { type: Date, default: Date.now },
  },
  { _id: false },
);

const TeamQuestStateSchema = new Schema(
  {
    roomCode: { type: String, index: true, required: true },
    teamId:   { type: String, required: true },
    tasksetId:{ type: Schema.Types.ObjectId, ref: "TaskSet" },

    coins: { type: Number, default: 0, min: 0 },

    // Inventory uses Map<string, number> so additions are atomic via $inc
    inventory: { type: Map, of: Number, default: () => new Map() },

    completedObjectives:    { type: [String], default: [] },
    completedCoreTaskIds:   { type: [String], default: [] },   // for unlock engine's coreProgressPct
    unlockedBonusTaskIds:   { type: [String], default: [] },
    unlockedHiddenTaskIds:  { type: [String], default: [] },
    completedBonusTaskIds:  { type: [String], default: [] },
    completedHiddenTaskIds: { type: [String], default: [] },

    questRank: { type: String, default: null },

    // The scarce "specialty" resource this team was seeded with (comparative
    // advantage): cheap for them to trade away, expensive for others to buy
    // from the depot. Assigned once, deterministically, on first state fetch.
    specialtyResourceId: { type: String, default: "" },
    // The specialty is a RENEWABLE node: it regenerates +1 every regen interval
    // (up to a cap) so the team keeps being a supplier ("come back later, we'll
    // have some"). This timestamp anchors the regen clock.
    specialtyLastRegenAt: { type: Date, default: null },

    tradeHistory:        { type: [TradeRecordSchema], default: [] },
    contributionRecords: { type: [ContributionRecordSchema], default: [] },
  },
  { timestamps: true },
);

// Unique per (room, team) — each team has exactly one state row per room.
TeamQuestStateSchema.index({ roomCode: 1, teamId: 1 }, { unique: true });

const TeamQuestState = mongoose.model("TeamQuestState", TeamQuestStateSchema);
export default TeamQuestState;
