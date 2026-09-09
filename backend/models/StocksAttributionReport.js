// StocksAttributionReport
//
// P3 (2026-09-09) — periodic top-level portfolio attribution snapshot.
// One row per (email, asOfDate). The row contains:
//   • header:    windowStart..asOfDate, coverage %, sleeve mix, cash %
//   • waterfall: additive attribution (only when defensibly additive)
//   • rootCause: top 3 sources of drag + top 3 sources of value
//   • details:   selection alpha, entry timing, exit forward alpha,
//                sizing effect, replacement-trade grade,
//                sector/industry attribution, FX attribution,
//                churn, cash drag, real-vs-passive table
//   • dataQuality: coverage per component
//   • notes:     any DESCRIPTIVE / NON-ADDITIVE flags surfaced
//
// The engine writes this on demand; the API returns it verbatim.

import mongoose from "mongoose";

const AttributionReportSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    asOfDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    windowStart: { type: String, default: null },
    windowDays: { type: Number, default: null, index: true }, // P3.5 — 30/90/YTD/max
    generatedAt: { type: Date, default: Date.now },
    engineVersion: { type: String, default: "3.5.0" },
    sufficient: { type: Boolean, default: true },
    insufficientEvidence: { type: [String], default: [] },

    header: { type: mongoose.Schema.Types.Mixed, default: {} },
    waterfall: { type: mongoose.Schema.Types.Mixed, default: {} },
    rootCause: { type: mongoose.Schema.Types.Mixed, default: {} },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    dataQuality: { type: mongoose.Schema.Types.Mixed, default: {} },
    notes: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Multi-window support (P3.5): allow one row per (email, asOfDate,
// windowDays). Existing unique index on (email, asOfDate) needs to be
// dropped by an operator before this new one takes hold, if any older
// prod rows exist.
AttributionReportSchema.index({ email: 1, asOfDate: 1, windowDays: 1 }, { unique: true, sparse: true });

const StocksAttributionReport = mongoose.model("StocksAttributionReport", AttributionReportSchema);
export default StocksAttributionReport;
