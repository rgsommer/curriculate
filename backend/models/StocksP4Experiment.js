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
    startDate: { type: String, required: true, index: true },   // YYYY-MM-DD
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

// FIRST-WRITE-WINS: freeze the pre-save hook so an accidental
// findOneAndUpdate cannot rewrite an existing definition. Callers
// must create a NEW experimentId for material changes.
Schema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error("StocksP4Experiment: existing rows are immutable. Create a new experimentId instead."));
  }
  next();
});

const StocksP4Experiment = mongoose.model("StocksP4Experiment", Schema);
export default StocksP4Experiment;
