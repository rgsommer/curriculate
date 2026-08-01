// backend/models/StocksAdviceRec.js
//
// One row per actionable trade recommendation emitted by the advice engine.
// Used to compute "if you had followed every recommendation, your portfolio
// would be X% over the last 7d / 14d / 30d."

import mongoose from "mongoose";

const StocksAdviceRecSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    generatedAt: { type: Date, required: true, default: Date.now, index: true },
    source: { type: String, enum: ["ai", "rule", "auto-sell-trail"], default: "ai" },
    // Granular source label for the per-source scorecard — the enum-narrow
    // `source` field above stays for backward compat, this one lets us
    // distinguish sonnet-briefing / sonnet-advice / sonnet-consensus /
    // high-conviction / moonshot / discovery-pool / rule-stop / etc. so the
    // "baseball cards" scorecard can compare per-source performance.
    // Free-string on purpose — enum churn every time we add a source type
    // isn't worth the type safety.
    sourceLabel: { type: String, default: null, index: true },
    // Set on trail-SELL recs auto-emitted when a BUY rec's target or stop
    // fires, so /advice history shows the full BUY→SELL round trip.
    linkedBuyRecId: { type: mongoose.Schema.Types.ObjectId, ref: "StocksAdviceRec", default: null, index: true },
    // Set on BUY recs whose targets/stops were AUTO-FILLED from technicals
    // when the AI omitted them — so we can audit the derivation later
    // (rather than silently attributing default values to the AI's judgment).
    exitLevelsFilledBy: { type: String, enum: [null, "ai", "atr-defaults"], default: null },

    // Parsed from the recommendation body
    ticker: { type: String, required: true, uppercase: true },
    action: { type: String, enum: ["BUY", "SELL", "TRIM", "HOLD"], required: true },
    // Target account for the trade (RRSP / TFSA / Non-Spousal / etc.).
    // Free-string so a portfolio can rename its accounts without an
    // enum migration. Optional — legacy recs and unspecified recs
    // stay null. Populated by the <RECS> JSON block starting 2026-08.
    account: { type: String, default: null, index: true },
    shares: { type: Number, default: null },
    entryPrice: { type: Number, default: null },
    entryCurrency: { type: String, enum: ["USD", "CAD"], default: "USD" },
    targetPrice: { type: Number, default: null },
    stopPrice: { type: Number, default: null },
    horizonDays: { type: Number, default: 30 },
    // Preferred execution window per market-microstructure realities.
    //   pre-market     — queue for the 9:30 opening auction; use for gap-and-go
    //                    setups where a missed open kills the thesis
    //   at-open        — first 15 min; use rarely, only when volatility itself is the setup
    //   post-10am      — wait for spreads to tighten after opening chaos; the default
    //   gtc           — no timing preference; leave order working until filled/cancelled
    // Populated by the AI from the <RECS> JSON block; null when unspecified.
    orderTiming: {
      type: String,
      enum: [null, "pre-market", "at-open", "post-10am", "gtc"],
      default: null,
    },

    // Optional: the raw body of the card the rec came from (for display)
    rationale: { type: String, default: "" },

    // Lazily filled when /performance is queried
    lastScoredAt: { type: Date, default: null },
    lastScoredPrice: { type: Number, default: null },
    lastPnlPct: { type: Number, default: null }, // signed by action direction

    // Lifecycle — updated by monitorOpenRecs() before each briefing
    status: {
      type: String,
      enum: ["open", "target-hit", "stop-hit", "expired"],
      default: "open",
      index: true,
    },
    hitAt: { type: Date, default: null },
    hitPrice: { type: Number, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastCheckedPrice: { type: Number, default: null },
  },
  { timestamps: true }
);

// Avoid duplicate recs (same ticker+action+entry within a short window)
StocksAdviceRecSchema.index({ email: 1, ticker: 1, action: 1, generatedAt: 1 });

const StocksAdviceRec =
  mongoose.models.StocksAdviceRec ||
  mongoose.model("StocksAdviceRec", StocksAdviceRecSchema);

export default StocksAdviceRec;
