// StocksPickDistribution
//
// P0B (2026-09-08) — empirical calibration corpus for the daily pick
// engine. Every time generateDailyPicksForUser runs, we persist the
// full ranked candidate distribution (top 30 by composite) BEFORE the
// absolute qualifying threshold applies. The daily record captures:
//
//   • which tickers were in the running that day
//   • their composite score, technical sub-score, external adjustment,
//     news bump, quality-compounder bump, sector rank
//   • whether each cleared the absolute qualifying threshold
//   • the effective threshold values on that day (so a future threshold
//     change doesn't invalidate the calibration corpus — we know what
//     was in force at the time)
//
// Purpose: with this history we can answer "what would picks with
// composite ≥80 have returned over the last 90 days?" — the answer
// drives the ABS_QUALIFYING_THRESHOLD, not intuition. Also the source
// data for the "missed winners" diagnostic (weekly): tickers that
// were in this distribution but NOT selected AND subsequently made a
// major move → identify why they were below the threshold.
//
// Not user-scoped by default: the pick universe is the same for every
// user right now (portfolio-independent). email is stored so a future
// per-user universe migration doesn't need a schema change.

import mongoose from "mongoose";

const CandidateSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, index: true },
    currency: { type: String, default: "USD" },
    rank: { type: Number, required: true },      // 1 = top (by champion composite)
    compositeRank: { type: Number, default: null },
    technicalScore: { type: Number, default: null },
    externalAdjustment: { type: Number, default: 0 },
    externalConvictionScore: { type: Number, default: 0 },
    nominationCount: { type: Number, default: 0 },
    newsCatalystBump: { type: Number, default: 0 },
    qualityCompounderBump: { type: Number, default: 0 },
    setupName: { type: String, default: null },
    mtfConfluence: { type: String, default: null },
    sectorRank: { type: Number, default: null },
    entryPrice: { type: Number, default: null },
    qualified: { type: Boolean, default: false, index: true },
    selected: { type: Boolean, default: false, index: true },
    disqualifyReason: { type: String, default: null },

    // ─── P2 additions: OQ/EQ split + provenance for missed-winner audit
    // Opportunity Quality (WHAT to own) — independent of chart timing.
    opportunityScore: { type: Number, default: null },
    // Entry Quality (WHEN to buy) — chart / setup / MTF / RVOL / etc.
    entryScore: { type: Number, default: null },
    // Tier from stocksEntryScore.classifyOqEqTier:
    //   BUY_CANDIDATE | WATCH_HIGH_QUALITY_NO_ENTRY |
    //   WATCH_SETUP_NO_QUALITY | OK | BELOW_THRESHOLD
    oqEqTier: { type: String, default: null, index: true },
    // Industry-strength signal { score, source, industry, sector, … }
    industryStrength: { type: mongoose.Schema.Types.Mixed, default: null },
    // Full factor breakdown at score time so P3/P4 alpha attribution
    // can decompose winners into which factor carried the pick.
    factorBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    // Per-model composite scores { A, B, C, D, E, F } for future shadow
    // testing (P4). Champion picks by scoreByModel.A; challengers'
    // scores are captured but not acted on until P4 promotes.
    scoreByModel: { type: mongoose.Schema.Types.Mixed, default: null },
    // Gates the candidate FAILED, ordered by point of failure. E.g.:
    //   ["stage1-below-tech-floor"]  (never entered Stage 2)
    //   ["stage2-below-composite-threshold", "no-external-nomination"]
    // Empty array = passed every gate ⇒ selected.
    failedGates: { type: [String], default: [] },
    // Snapshot price / as-of at score time — needed so a later
    // "why did we miss XYZ" analysis has the same view the engine did.
    priceAtScore: { type: Number, default: null },
    dataAsOf: { type: Date, default: null },
    // P2.5: per-candidate coverage % (0..100) of the CHAMPION model's
    // declared weight that had real data. Downstream analysis can weigh
    // confidence by this — a candidate at 50% coverage should never be
    // reported to the operator with the same confidence as one at 100%.
    factorCoveragePct: { type: Number, default: null },
    // Per-model critical-factor status: { A: {status, missing[]}, ... }.
    // Lets P4 filter out INSUFFICIENT_DATA rows from a challenger's
    // shadow portfolio without re-computing anything.
    criticalFactorCoverage: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const PickDistributionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    pickDate: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    generatedAt: { type: Date, required: true, default: Date.now },
    // Threshold values in force at generation time.
    thresholds: {
      absComposite: { type: Number, default: null },
      absExternal: { type: Number, default: null },
      absConfirmations: { type: Number, default: null },
      n: { type: Number, default: null },
      minScore: { type: Number, default: null },
    },
    universeSize: { type: Number, default: 0 },
    scoredCount: { type: Number, default: 0 },
    rescuedCount: { type: Number, default: 0 },
    // Full ranked distribution — top 30 (or fewer if the universe is
    // small). Rank 1 = highest composite.
    candidates: { type: [CandidateSchema], default: [] },
    // How many qualified vs how many were surfaced.
    qualifiedCount: { type: Number, default: 0 },
    selectedCount: { type: Number, default: 0 },
    // "NO QUALIFYING OPPORTUNITY TODAY" flag for quick queries. true
    // when nothing in the universe cleared the threshold; the day was
    // valid, we just didn't have signal strength.
    noQualifyingOpportunity: { type: Boolean, default: false, index: true },
    // Free-form note (e.g. "kill-switch canary" or "engine suppressed").
    note: { type: String, default: null },
    // P2: which scoring model produced the `selected` set (champion is
    // "A"). All models' per-candidate scores appear in candidate.scoreByModel.
    championModelId: { type: String, default: "A" },
    // P2: engine version so the calibration corpus knows which rules
    // and funnel produced this row. Bump on rule changes.
    engineVersion: { type: String, default: null },
    // P2: funnel widths in force at generation time — universe,
    // stage-1 preserved, stage-2 fundamentals input, rescue-pool.
    funnel: {
      universeSize: { type: Number, default: null },
      stage1TopK: { type: Number, default: null },
      rescueTopK: { type: Number, default: null },
      stage3TopK: { type: Number, default: null }, // adversarial/vision budget
    },
    // P2: how many WATCH — HIGH-QUALITY-NO-ENTRY rows were emitted
    // from this day's distribution (persisted separately in
    // StocksWatchListEntry).
    watchHighQualityCount: { type: Number, default: 0 },
    // P2.5: Stage-1 shadow funnel record — top-150 tickers by pure
    // technical score with per-funnel-width flags {narrow, medium, wide}.
    // Cheap to persist (150 × small rows). Lets P4 measure whether
    // widening the funnel would have caught additional winners.
    stage1Shadow: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

// One distribution row per (email, pickDate) — an idempotent upsert
// key so a cron retry doesn't dupe.
PickDistributionSchema.index({ email: 1, pickDate: 1 }, { unique: true });

const StocksPickDistribution = mongoose.model(
  "StocksPickDistribution",
  PickDistributionSchema
);

export default StocksPickDistribution;
