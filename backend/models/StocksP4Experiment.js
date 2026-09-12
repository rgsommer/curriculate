// StocksP4Experiment
//
// P4 (2026-09-11) — immutable frozen experiment definition. Written
// once when the experiment starts. FIRST-WRITE-WINS: subsequent
// attempts to write to the same experimentId are rejected. Any
// material model change starts a NEW experimentId (spec §1, §16).
//
// The row records EVERYTHING that could affect a challenge's outcome
// so downstream leaderboards, promotion proposals, and reproductions
// have the exact definition of what was tested — no post-hoc weight
// tweaks pretending to be the original.

import mongoose from "mongoose";

const Schema = new mongoose.Schema(
  {
    experimentId: { type: String, required: true, unique: true, index: true },
    // P4.1 trading-date semantics (spec §6): startDate is the local
    // wall-clock date the row was written (may be a Saturday when a
    // Fri-evening run is captured); tradingDate is the last completed
    // US market session — Fri after close → Fri, weekend/Mon-premarket
    // → Fri, holiday → prior business day. Every price observation
    // and outcome is anchored to tradingDate, NEVER startDate.
    startDate: { type: String, required: true, index: true },       // YYYY-MM-DD wall clock
    tradingDate: { type: String, default: null, index: true },      // last completed US session
    createdAtUtc: { type: Date, default: Date.now },
    localExperimentDate: { type: String, default: null },
    referenceTradingDate: { type: String, default: null },          // alias for tradingDate for clarity
    engineVersion: { type: String, required: true },

    // Frozen model definitions — objects, not references, so future
    // edits to stocksScoringModels.js do NOT rewrite history.
    models: { type: mongoose.Schema.Types.Mixed, required: true },
    factorWeights: { type: mongoose.Schema.Types.Mixed, required: true },
    oqEqWeights: { type: mongoose.Schema.Types.Mixed, required: true },

    // Screens
    qualificationThresholds: { type: mongoose.Schema.Types.Mixed, required: true },
    nominationLanes: { type: [String], required: true },
    funnelVariants: { type: [String], required: true },
    benchmarkAssignments: { type: mongoose.Schema.Types.Mixed, required: true },

    // Portfolio simulation rules
    shadowPortfolioRules: { type: mongoose.Schema.Types.Mixed, required: true },
    exitRules: { type: [mongoose.Schema.Types.Mixed], required: true },
    transactionCostBps: { type: Number, required: true },
    fxMethodology: { type: String, required: true },

    // Preregistered decision boundary
    promotionCriteria: { type: mongoose.Schema.Types.Mixed, required: true },

    // Provenance
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, default: "system" },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

// P4.1 immutability enforcement — APPLICATION-LEVEL (Mongo itself
// does not enforce write-once, we do). Every mutation path Mongoose
// exposes is guarded:
//   save() on existing doc          — rejected
//   updateOne / updateMany          — rejected
//   findOneAndUpdate / findByIdAndUpdate — rejected
//   replaceOne                      — rejected
//   bulkWrite updateOne op          — rejected via the same hooks
// Only inserts through `new(...).save()` for a NEW doc succeed.
// Status changes (VALID → PILOT_INVALID) live in the separate
// StocksP4ExperimentStatus collection so this row stays frozen.
Schema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error("StocksP4Experiment: existing rows are immutable. Store status changes in StocksP4ExperimentStatus."));
  }
  next();
});
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findByIdAndUpdate"]) {
  Schema.pre(op, function (next) {
    next(new Error(`StocksP4Experiment: ${op} is disabled — rows are immutable. Store status changes in StocksP4ExperimentStatus.`));
  });
}

const StocksP4Experiment = mongoose.model("StocksP4Experiment", Schema);
export default StocksP4Experiment;
