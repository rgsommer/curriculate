// StocksShadowFunnelRun
//
// P2.6 (2026-09-09) — persists what NARROW / MEDIUM / WIDE funnels
// would have actually surfaced on the same market snapshot when the
// engine runs a shadow experiment (env `STOCKS_SHADOW_FUNNEL_WIDTHS`).
//
// One row per (pickDate, funnel, rank). Idempotent per (pickDate,
// funnel, ticker) so a repeated experiment on the same day overwrites
// but never duplicates.
//
// funnel ∈ { "narrow" | "medium" | "wide" }
//   narrow  = 30 + 15  (production default)
//   medium  = 75 + 30
//   wide    = 150 + 75
//
// This is SHADOW ONLY — it never influences production picks.
// The engine also captures the ACTUAL OQ/EQ/model scores as of THIS
// snapshot (walked forward = look-ahead-free) so P4 can measure
// whether widening discovery caught real winners or added noise.

import mongoose from "mongoose";

const ShadowFunnelRunSchema = new mongoose.Schema(
  {
    pickDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    funnel: { type: String, required: true, index: true },   // narrow | medium | wide
    ticker: { type: String, required: true, index: true },
    rank: { type: Number, required: true },                   // 1 = top by champion combined
    technicalScore: { type: Number, default: null },
    compositeRank: { type: Number, default: null },
    opportunityScore: { type: Number, default: null },
    entryScore: { type: Number, default: null },
    combined: { type: Number, default: null },
    // All-model scores for this candidate under this funnel width.
    // { A: { opportunity, entry, combined, status, factorCoveragePct },
    //   B: {...}, ... }
    scoreByModel: { type: mongoose.Schema.Types.Mixed, default: null },
    // Would this candidate have QUALIFIED at the P0B absolute threshold?
    qualified: { type: Boolean, default: false },
    disqualifyReason: { type: String, default: null },
    priceAtScore: { type: Number, default: null },
    dataAsOf: { type: Date, default: Date.now },
    engineVersion: { type: String, default: null },
  },
  { timestamps: true }
);

ShadowFunnelRunSchema.index({ pickDate: 1, funnel: 1, ticker: 1 }, { unique: true });

const StocksShadowFunnelRun = mongoose.model("StocksShadowFunnelRun", ShadowFunnelRunSchema);
export default StocksShadowFunnelRun;
