// backend/models/StocksBriefingHistory.js
//
// Append-only per-briefing archive so the next briefing can reference
// what the previous one said. Without this, each briefing is generated
// in isolation — the AI has no memory of yesterday's calls and can
// contradict itself day-to-day (recommend BUY CNQ Mon, then TRIM CNQ
// Tue on a 0.1% gain, then re-BUY CNQ Wed).
//
// Distinct from StocksAdviceSnapshot which is single-doc-per-email and
// gets overwritten each generation. This one keeps every briefing so
// the prompt builder can inject the last 1-3 as continuity context.
//
// Kept lean on purpose: markdown + a short excerpt of per-ticker calls
// so we don't blow the Anthropic prompt-cache when we replay 2 days of
// briefings into the next one.

import mongoose from "mongoose";

const StocksBriefingHistorySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    generatedAt: { type: Date, default: Date.now, index: true },
    source: { type: String, enum: ["cron", "on-demand", "intraday", "eod"], default: "cron" },
    markdown: { type: String, default: "" },
    // Pre-extracted per-ticker calls (HOLD/TRIM/ADD/EXIT with rationale)
    // so the next briefing's prompt can inject only what's needed
    // instead of the whole 15KB markdown.
    callsExcerpt: { type: String, default: "" },
    // Discipline critic (OpenAI gpt-4o-mini) violations flagged on this
    // briefing. Each entry: {rule 1-5, ticker, quote, reason}. Empty if
    // the critic was off, the briefing was clean, or the audit failed.
    // Used by the compliance surface (trend view) and by the next
    // briefing's prompt (fed back as "don't repeat these patterns").
    criticViolations: {
      type: [{
        rule: { type: Number, required: true, min: 1, max: 5 },
        ticker: { type: String, default: null },
        quote: { type: String, required: true },
        reason: { type: String, default: "" },
      }],
      default: [],
      _id: false,
    },
  },
  { timestamps: true }
);

// TTL index — auto-expire history rows older than 30 days. We only
// need the last 1-3 briefings for continuity; anything older is dead
// weight in the DB.
StocksBriefingHistorySchema.index({ generatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const StocksBriefingHistory =
  mongoose.models.StocksBriefingHistory ||
  mongoose.model("StocksBriefingHistory", StocksBriefingHistorySchema);

export default StocksBriefingHistory;
