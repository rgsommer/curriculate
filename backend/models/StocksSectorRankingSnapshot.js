// backend/models/StocksSectorRankingSnapshot.js
//
// Weekly snapshot of the 11-SPDR-sector RS ranking. Enables week-over-week
// transition detection so the briefing's SECTOR TILT line can be paired
// with a "🔄 Rotation:" line showing which sectors moved IN/OUT of the
// leader / laggard cohorts.
//
// One document per (snapshotDate = Monday of the ET week). Written lazily
// inside getSectorRotation() the first time a briefing runs each week —
// no cron. Compare against the most recent snapshot older than 6 days to
// compute transitions.
//
// TTL of 90 days: we only ever compare against last week, so anything
// older than a couple months is dead weight.

import mongoose from "mongoose";

const RankingRowSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },   // XLK, XLF, etc.
    name: { type: String, default: "" },        // "Technology"
    rank: { type: Number, required: true },     // 1 = strongest leader
    rel20d: { type: Number, default: null },    // RS vs SPY over 20d (pp)
    rel60d: { type: Number, default: null },    // RS vs SPY over 60d (pp)
  },
  { _id: false }
);

const StocksSectorRankingSnapshotSchema = new mongoose.Schema(
  {
    // Monday of the ET week this snapshot represents. One doc per week.
    snapshotDate: { type: Date, required: true, unique: true, index: true },
    ranking: { type: [RankingRowSchema], default: [] },
  },
  { timestamps: true }
);

// Auto-expire after 90 days — comparison only ever looks 6-8 days back.
StocksSectorRankingSnapshotSchema.index(
  { snapshotDate: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

const StocksSectorRankingSnapshot =
  mongoose.models.StocksSectorRankingSnapshot ||
  mongoose.model("StocksSectorRankingSnapshot", StocksSectorRankingSnapshotSchema);

export default StocksSectorRankingSnapshot;
