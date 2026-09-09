// StocksScoreSnapshot
//
// P2.5 (2026-09-09) — IMMUTABLE point-in-time snapshot of the exact
// factor inputs used to score a candidate at recommendation time.
//
// This is the file that makes clean walk-forward evaluation possible.
// Fundamentals and growth reads from FMP are CURRENT-ONLY (no
// historical TTM stored anywhere), so without a snapshot at score
// time, a P4 replay reading fundamentals TODAY would read the WRONG
// state and biased results.
//
// One row per (ticker, pickDate). Immutable — never updated after
// write. If the engine rescored the same ticker later in the day
// (e.g. because a fastPreview re-ran), the FIRST snapshot wins.
//
// Contents:
//   • fundamentalsRaw            — as returned by getFundamentals
//   • growthRaw                  — as returned by getGrowth
//   • estimateRevisionRaw        — as returned by getRealEpsRevisions
//   • priceTargetRaw             — the OLD price-target proxy (kept
//                                  as CONTEXT signal per P2.5 §1)
//   • techSummary                — flat subset from getTechnicals
//   • industryStrengthRaw        — full return from getIndustryStrength
//   • surpriseHistorySample      — most-recent 4 rows of surprise cache
//   • catalystSample             — most-recent 5 catalyst rows
//
// Everything is Mixed — schema-less on purpose. The raw shape may
// evolve; the snapshot preserves whatever we knew then.

import mongoose from "mongoose";

const ScoreSnapshotSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    ticker: { type: String, required: true, index: true },
    pickDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    dataAsOf: { type: Date, default: Date.now },
    engineVersion: { type: String, default: null },
    modelId: { type: String, default: "A" },

    // Every raw factor input the engine consulted, verbatim.
    inputs: {
      fundamentalsRaw: { type: mongoose.Schema.Types.Mixed, default: null },
      growthRaw: { type: mongoose.Schema.Types.Mixed, default: null },
      estimateRevisionRaw: { type: mongoose.Schema.Types.Mixed, default: null },
      priceTargetRaw: { type: mongoose.Schema.Types.Mixed, default: null },
      techSummary: { type: mongoose.Schema.Types.Mixed, default: null },
      industryStrengthRaw: { type: mongoose.Schema.Types.Mixed, default: null },
      insiderRaw: { type: mongoose.Schema.Types.Mixed, default: null },
      surpriseHistorySample: { type: [mongoose.Schema.Types.Mixed], default: [] },
      catalystSample: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    // Computed scores that came from those inputs (for tie-back).
    scores: { type: mongoose.Schema.Types.Mixed, default: null },
    factorCoveragePct: { type: Number, default: null },
    criticalFactorCoverage: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Immutable — enforce first-write-wins at the DB layer.
ScoreSnapshotSchema.index({ email: 1, ticker: 1, pickDate: 1 }, { unique: true });

const StocksScoreSnapshot = mongoose.model("StocksScoreSnapshot", ScoreSnapshotSchema);
export default StocksScoreSnapshot;
