// backend/models/StocksRejectionLog.js
//
// Persisted record of every rec-validator rejection (Tier 2.3 audit
// Aug-28). Prior state: validator returned {accepted, rejected}, the
// briefing stripped rejected from the emitted markdown, and the
// rejected rows were logged to stdout and thrown away.
//
// This model gives the redesign a queryable corpus of "candidates the
// system considered but did not act on" — which the audit identified
// as the missing raw material for learning where discovery fails.
//
// One doc per (email, generatedAt, ticker, reason). Composite index
// on (email, generatedAt) supports the future "rejections in the last
// N days" report, and (reason) supports "which rejection reasons fire
// most often" analysis.
//
// Free-form `detail` is the human-readable rejection message the
// validator produced. `snapshot` preserves the rec shape at rejection
// time (entryPrice, sleeve, sourceLabel, etc.) so a later coverage
// analysis can join back to what was proposed vs what happened next.

import mongoose from "mongoose";

const StocksRejectionLogSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    generatedAt: { type: Date, required: true, index: true },
    ticker: { type: String, required: true, uppercase: true, index: true },
    action: { type: String, required: true }, // BUY, SELL, TRIM, EXIT, ADD, HOLD
    // Rejection origin: validator (rec-validator rules), audit
    // (briefing-audit blockers), adversarial (adversarial-verify).
    // Kept as a field so downstream aggregations can filter by origin.
    origin: {
      type: String,
      enum: ["validator", "audit", "adversarial"],
      required: true,
      index: true,
    },
    reason: { type: String, required: true, index: true }, // kebab-case slug from validator/audit
    detail: { type: String, default: null },
    // Snapshot of the rec at rejection time — informational, joinable
    // to StocksAdviceRec for a "what did we lose by not shipping this"
    // counterfactual analysis. Kept as Mixed since AI-generated recs
    // have varying shapes.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // Optional session identifier — briefings are batched per user per
    // day; the sessionKey lets us group all rejections from one send.
    sessionKey: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

StocksRejectionLogSchema.index({ email: 1, generatedAt: -1 });
StocksRejectionLogSchema.index({ ticker: 1, generatedAt: -1 });
StocksRejectionLogSchema.index({ reason: 1, generatedAt: -1 });

export default mongoose.models.StocksRejectionLog
  || mongoose.model("StocksRejectionLog", StocksRejectionLogSchema);
