// backend/models/TruthOrDareRound.js
//
// One row per round in a Truth-or-Dare session. Captures everything we need
// to replay a round in analytics: who was picked, the challenge that landed,
// what they chose (truth/dare/double-dare/pass), the verdict, and the
// reward.
//
// See TRUTH_OR_DARE_PLAN.md §7 for the full schema spec.

import mongoose from "mongoose";

const { Schema } = mongoose;

const ChallengeSubSchema = new Schema(
  {
    id:               { type: String, default: "" },
    type:             { type: String, enum: ["truth", "dare"], required: true },
    tier:             { type: String, enum: ["sprout", "stem", "big"], default: "sprout" },
    category:         { type: String, default: "recall" },
    prompt:           { type: String, default: "" },
    teacherHint:      { type: String, default: "" },
    timeSeconds:      { type: Number, default: 30 },
    physicalIntensity:{ type: Number, default: 0 },
    socialIntensity:  { type: Number, default: 1 },
    noiseExpected:    { type: Number, default: 0 },
    acceptableAnswers:{ type: [String], default: [] },
    judgmentMode:     { type: String, enum: ["ai", "teacher", "class-vote"], default: "teacher" },
    rewardTier:       { type: String, enum: ["small", "medium", "large"], default: "small" },
    sourceProvenance: { type: String, enum: ["ai", "library", "teacher-injected", "fallback"], default: "ai" },
    moderationVersion:{ type: String, default: "v1" },
  },
  { _id: false },
);

const TruthOrDareRoundSchema = new Schema(
  {
    sessionId:   { type: Schema.Types.ObjectId, ref: "TruthOrDareSession", index: true },
    roomCode:    { type: String, index: true },
    roundIndex:  { type: Number, required: true },

    selectedTeamId:    { type: String, required: true },
    selectedPlayerName:{ type: String, default: "" },

    promptHash:  { type: String, index: true },  // for cross-session dedupe
    choice:      { type: String, enum: ["truth", "dare", "double-dare", "pass"], default: null },

    challenge:   { type: ChallengeSubSchema, default: null },

    // Lifecycle timestamps
    performStartedAt:  { type: Date, default: null },
    performEndedAt:    { type: Date, default: null },
    performDurationMs: { type: Number, default: 0 },

    verdict:   { type: String, enum: ["pass", "fail", "retry", "skip"], default: null },
    verdictBy: { type: String, enum: ["ai", "teacher", "class-vote", "auto"], default: null },
    votes:     { type: Map, of: String, default: () => new Map() }, // teamId → emoji

    stealAttemptedBy: { type: String, default: "" },
    stealVerdict:     { type: String, enum: ["pass", "fail"], default: null },

    pointsAwarded: { type: Number, default: 0 },
    coinsAwarded:  { type: Number, default: 0 },
    specialItem:   { type: String, default: "" },

    flagged:    { type: Boolean, default: false },
    flagReason: { type: String, default: "" },
  },
  { timestamps: true },
);

TruthOrDareRoundSchema.index({ promptHash: 1, createdAt: -1 });
TruthOrDareRoundSchema.index({ sessionId: 1, roundIndex: 1 });

const TruthOrDareRound = mongoose.model("TruthOrDareRound", TruthOrDareRoundSchema);
export default TruthOrDareRound;
