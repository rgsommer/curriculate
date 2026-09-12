// StocksP4PickRecord
//
// P4 (2026-09-11) — per-(experiment, day, model, ticker) IMMUTABLE
// pick record. Persisted BEFORE any forward price is observed so a
// later outcome cannot re-shape the pick.
//
// This is the frozen ground truth the leaderboard, missed-winner and
// false-positive analyses all read against.

import mongoose from "mongoose";

const Schema = new mongoose.Schema(
  {
    experimentId: { type: String, required: true, index: true },
    pickDate: { type: String, required: true, index: true },     // YYYY-MM-DD
    model: { type: String, required: true, index: true },        // A..G
    funnel: { type: String, default: "NARROW", index: true },    // NARROW|MEDIUM|WIDE
    ticker: { type: String, required: true, index: true },

    // Immutable reference price + provenance
    referencePrice: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    referenceAsOf: { type: Date, required: true },

    // Model scores
    opportunityScore: { type: Number, default: null },
    entryScore: { type: Number, default: null },
    combinedScore: { type: Number, default: null },
    factorBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    factorCoverage: { type: Number, default: null },
    criticalFactorCoverage: { type: Boolean, default: null },
    confidence: { type: String, default: null },
    industryStrength: { type: mongoose.Schema.Types.Mixed, default: null },
    revisions: { type: mongoose.Schema.Types.Mixed, default: null },
    earnings: { type: mongoose.Schema.Types.Mixed, default: null },
    catalyst: { type: mongoose.Schema.Types.Mixed, default: null },
    technical: { type: mongoose.Schema.Types.Mixed, default: null },

    // Nomination provenance
    nominationLanes: { type: [String], default: [] },            // which lanes proposed it
    reasonNominated: { type: String, default: null },

    // Watchlist classification (spec §8) — WHY was this pick kept
    // vs discarded? Enables the watchlist-outcome analysis.
    classification: {
      type: String,
      enum: ["BUY_CANDIDATE", "WATCH_HIGH_QUALITY_NO_ENTRY", "WATCH_SETUP_NO_QUALITY", "REJECTED"],
      default: "REJECTED",
      index: true,
    },
    rejectionReason: { type: String, default: null },

    // Context
    sector: { type: String, default: null },
    industry: { type: String, default: null },
    regime: { type: String, default: null },
    benchmark: { type: String, default: null },
    engineVersion: { type: String, default: null },

    // Passive-model rows: G persists the passive ticker itself
    isPassiveControl: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One row per (experimentId, pickDate, model, funnel, ticker).
Schema.index(
  { experimentId: 1, pickDate: 1, model: 1, funnel: 1, ticker: 1 },
  { unique: true }
);

// Immutable once written. Any changes must be a NEW row (typically
// via a NEW experimentId when weights change).
Schema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error("StocksP4PickRecord: rows are immutable once written."));
  }
  next();
});

const StocksP4PickRecord = mongoose.model("StocksP4PickRecord", Schema);
export default StocksP4PickRecord;
