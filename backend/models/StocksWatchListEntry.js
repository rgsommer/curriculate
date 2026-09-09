// StocksWatchListEntry
//
// P2 (2026-09-08) — WATCH — HIGH-QUALITY / ENTRY-NOT-READY tracked as
// its own first-class row so P3/P4 can measure how many of these
// become winners while we waited for entry (and how many of them
// broke down before entry, validating the wait).
//
// One row per (email, pickDate, ticker). Persisted whenever the pick
// engine sees a candidate with a high Opportunity Quality but a low
// Entry Quality. Outcome tracking is a downstream job (P3): mark the
// entry gate as "entered", "broke down", or "still waiting" as prices
// move.

import mongoose from "mongoose";

const WatchListSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    pickDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    ticker: { type: String, required: true, index: true },
    currency: { type: String, default: "USD" },
    reason: { type: String, default: "high-quality-no-entry" },
    // Scores at time of add.
    opportunityScore: { type: Number, default: null },
    entryScore: { type: Number, default: null },
    // Which model produced the classification.
    modelId: { type: String, default: "A" },
    // Full factor breakdown at time of add, for later attribution.
    factorSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Price at add — needed to answer "would have earned N% if we'd
    // bought here" and to compute what the waiting cost/saved us.
    priceAtAdd: { type: Number, default: null },
    // Outcome fields (populated later).
    status: { type: String, default: "open", index: true }, // open | entered | broke_down | expired | resolved
    outcomeCheckedAt: { type: Date, default: null },
    outcomePriceHigh: { type: Number, default: null },
    outcomePriceLow: { type: Number, default: null },
    outcomeMovePct: { type: Number, default: null },
    outcomeNotes: { type: String, default: null },
  },
  { timestamps: true }
);

WatchListSchema.index({ email: 1, pickDate: 1, ticker: 1 }, { unique: true });

const StocksWatchListEntry = mongoose.model("StocksWatchListEntry", WatchListSchema);
export default StocksWatchListEntry;
