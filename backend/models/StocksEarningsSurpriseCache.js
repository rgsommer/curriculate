// StocksEarningsSurpriseCache
//
// P2.5 (2026-09-09) — cached FMP earnings-surprise rows plus the
// engine's computed post-earnings drift evaluation. Keeps rich
// per-report provenance so a later attribution can distinguish
// "surprise + gap held" winners from "surprise + gap failed" losers.
//
// One row per (ticker, earningsDate). Idempotent upsert.

import mongoose from "mongoose";

const EarningsSurpriseSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, index: true },
    earningsDate: { type: String, required: true, index: true }, // YYYY-MM-DD

    // From FMP earnings-surprises
    reportedEPS: { type: Number, default: null },
    estimatedEPS: { type: Number, default: null },
    epsSurprisePct: { type: Number, default: null }, // (reported - est) / |est|
    reportedRevenue: { type: Number, default: null },
    estimatedRevenue: { type: Number, default: null },
    revenueSurprisePct: { type: Number, default: null },

    // P2.6: release-timing metadata + explicit temporal alignment.
    // releaseTiming ∈ {pre-market, after-market, during-market, unknown}
    // timingConfident is true iff we had a bmo/amc label from FMP; for
    // during-market / unknown we ran the conservative after-market
    // alignment (never uses a pre-release price as post-release).
    releaseTiming: { type: String, default: null },
    timingConfident: { type: Boolean, default: false },
    preEventTradingDate: { type: String, default: null },
    reactionTradingDate: { type: String, default: null },
    preEventClose: { type: Number, default: null },
    reactionOpen: { type: Number, default: null },
    reactionDay1Close: { type: Number, default: null },
    reactionDay3Close: { type: Number, default: null },
    reactionDay5Close: { type: Number, default: null },
    gapRetentionPct: { type: Number, default: null },

    // Post-earnings drift evaluation (populated when we can score it —
    // needs enough post-report bars from Yahoo). ALL fields optional so
    // an outdated report that failed to fetch bars still persists.
    gapOpenPct: { type: Number, default: null },       // (day-1 open − day-0 close) / day-0 close
    day1ClosePct: { type: Number, default: null },     // day-1 close vs day-0 close
    day3ClosePct: { type: Number, default: null },
    day5ClosePct: { type: Number, default: null },
    day1VsBenchPct: { type: Number, default: null },
    day5VsBenchPct: { type: Number, default: null },
    day1Rvol: { type: Number, default: null },
    gapHeldAtDay5: { type: Boolean, default: null },   // gap open × 0.5 still intact at day 5
    postEarningsDriftScore: { type: Number, default: null }, // 0..100
    driftClassification: { type: String, default: null },     // POSITIVE_ACCEPTANCE | POSITIVE_FAILED | NEGATIVE | NEUTRAL | INSUFFICIENT_DATA

    // Raw payload snippet for auditability.
    rawSurprise: { type: mongoose.Schema.Types.Mixed, default: null },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

EarningsSurpriseSchema.index({ ticker: 1, earningsDate: 1 }, { unique: true });

const StocksEarningsSurpriseCache = mongoose.model(
  "StocksEarningsSurpriseCache",
  EarningsSurpriseSchema
);
export default StocksEarningsSurpriseCache;
