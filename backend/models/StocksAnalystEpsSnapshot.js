// StocksAnalystEpsSnapshot
//
// P2.5 (2026-09-09) — daily point-in-time snapshot of FMP analyst
// estimates for a ticker. Persisted every time getRealEpsRevisions()
// runs so future comparisons ("EPS estimate today vs 4/12/26 weeks
// ago") are backed by data we actually recorded on those dates rather
// than reconstructed from a moving-target current call.
//
// One row per (ticker, ymd) — idempotent upsert per calendar day.
//
// The field names track FMP's `/api/v3/analyst-estimates/{sym}` shape
// so a raw-payload comparison later doesn't need transformation.
// Values are stored as reported (typically per-share currency of
// the primary listing).

import mongoose from "mongoose";

const EpsSnapshotSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, index: true },
    ymd: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    fetchedAt: { type: Date, default: Date.now },

    // Current fiscal year (FY0) — analysts' consensus estimate.
    fy0_eps: { type: Number, default: null },
    fy0_revenue: { type: Number, default: null },
    // Next fiscal year (FY1).
    fy1_eps: { type: Number, default: null },
    fy1_revenue: { type: Number, default: null },
    // Current quarter (Q0) and next quarter (Q1).
    q0_eps: { type: Number, default: null },
    q0_revenue: { type: Number, default: null },
    q1_eps: { type: Number, default: null },
    q1_revenue: { type: Number, default: null },

    // Number of analysts covering — FMP splits by revenue/EPS in some
    // endpoints. Keep both; use the higher for breadth calculations.
    analystCountEps: { type: Number, default: null },
    analystCountRevenue: { type: Number, default: null },

    // Raw payload snippet (first row from FMP) — kept for auditability
    // so a future analysis can see EXACTLY what we recorded.
    rawSample: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

EpsSnapshotSchema.index({ ticker: 1, ymd: 1 }, { unique: true });
EpsSnapshotSchema.index({ ticker: 1, fetchedAt: -1 });

const StocksAnalystEpsSnapshot = mongoose.model(
  "StocksAnalystEpsSnapshot",
  EpsSnapshotSchema
);
export default StocksAnalystEpsSnapshot;
