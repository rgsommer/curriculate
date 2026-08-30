// backend/models/StocksMissedWinnerCoverage.js
//
// Daily snapshot of the missed-winner coverage KPI (Tier 2.3 audit
// Aug-28). The single measurement that answers "is discovery
// working?" — computed as: for the top-decile weekly gainers in the
// investable universe on date D, how many were ever in our pick
// universe or discovery pool in the trailing look-back window?
//
// Structure:
//   observedAt      — the date the snapshot ran (once per day)
//   asOfDate        — the trading day being measured
//   universe        — total tickers in the reference investable pool
//                     (used as denominator for the top-decile cutoff)
//   topDecileCount  — count of top-decile weekly winners this day
//   inOurUniverse   — count of top-decile winners that appeared in
//                     our recent (60d) pick engine universe
//   inOurDiscovery  — count that appeared in recent discovery scans
//   inEither        — count in either pool (dedupe)
//   coveragePct     — inEither / topDecileCount × 100 — the KPI
//   caughtEarly     — count that made it to a persisted BUY rec
//                     (not just a scan-universe entry) before rising
//   missed          — count that never entered any of our pools
//   samples         — small array of {ticker, weeklyReturnPct, source:
//                     "in-universe"|"in-discovery"|"caught-early"|"missed"}
//                     for operator inspection.
//
// The samples cap keeps the doc small (~50KB max at 50 samples). Full
// per-ticker attribution is derivable from source tables (Yahoo
// history, StocksAdviceRec, StocksDiscoveryCandidate).

import mongoose from "mongoose";

const SampleSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, uppercase: true },
    weeklyReturnPct: { type: Number, default: null },
    source: {
      type: String,
      enum: ["in-universe", "in-discovery", "caught-early", "missed"],
      required: true,
    },
    // For "caught-early" rows: rec date + rec entryPrice so ROI vs the
    // week's peak is auditable.
    recDate: { type: Date, default: null },
    recEntryPrice: { type: Number, default: null },
  },
  { _id: false }
);

const StocksMissedWinnerCoverageSchema = new mongoose.Schema(
  {
    observedAt: { type: Date, required: true, index: true },
    // asOfDate is the trading day being scored (typically the previous
    // Friday for weekly-return computation). Unique index declared at
    // schema level below; no field-level index here (Mongoose would
    // create a duplicate non-unique one).
    asOfDate: { type: Date, required: true },
    universeSize: { type: Number, default: 0 },
    topDecileCount: { type: Number, default: 0 },
    inOurUniverse: { type: Number, default: 0 },
    inOurDiscovery: { type: Number, default: 0 },
    inEither: { type: Number, default: 0 },
    caughtEarly: { type: Number, default: 0 },
    missed: { type: Number, default: 0 },
    coveragePct: { type: Number, default: 0 },
    caughtEarlyPct: { type: Number, default: 0 },
    // Free-form context for the snapshot (thresholds used, e.g.
    // top-decile cutoff, look-back window in days). Kept as Mixed so
    // the tuning knobs can evolve without model changes.
    context: { type: mongoose.Schema.Types.Mixed, default: null },
    samples: { type: [SampleSchema], default: [] },
    // Optional failure trace — if the snapshot could not compute (data
    // fetch failed), record why so the KPI dashboard can distinguish
    // "no snapshot" from "snapshot: coverage was 0".
    error: { type: String, default: null },
  },
  { timestamps: true }
);

// One row per calendar day (asOfDate). Duplicates on the same asOfDate
// overwrite via upsert on this key.
StocksMissedWinnerCoverageSchema.index({ asOfDate: 1 }, { unique: true });

export default mongoose.models.StocksMissedWinnerCoverage
  || mongoose.model("StocksMissedWinnerCoverage", StocksMissedWinnerCoverageSchema);
