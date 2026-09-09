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
    generatedAt: { type: Date, default: Date.now },
    engineVersion: { type: String, default: "3.0.0" },

    header: { type: mongoose.Schema.Types.Mixed, default: {} },
    waterfall: { type: mongoose.Schema.Types.Mixed, default: {} },
    rootCause: { type: mongoose.Schema.Types.Mixed, default: {} },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    dataQuality: { type: mongoose.Schema.Types.Mixed, default: {} },
    notes: { type: [String], default: [] },
  },
  { timestamps: true }
);

AttributionReportSchema.index({ email: 1, asOfDate: 1 }, { unique: true });

const StocksAttributionReport = mongoose.model("StocksAttributionReport", AttributionReportSchema);
export default StocksAttributionReport;
