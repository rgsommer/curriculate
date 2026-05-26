// backend/models/StocksDiscoveryCandidate.js
//
// One document per (email, ticker, scanDate) discovery candidate.
//
// Discovery candidates are stocks NOT in the user's current portfolio that
// the AI thinks warrant a closer look as potential multi-bagger or
// catalyst-driven setups. Each candidate captures:
//   - Why it surfaced (fundamentals + composite score)
//   - AI-written thesis (bull case, kill thesis, price target, horizon, conviction)
//   - User actions (starred, dismissed, added to portfolio)
//   - Price tracking for hit-rate scorecard (priceAtDiscovery → updated over time)
//
// The scorecard will later compare priceAtDiscovery to current price at
// 30/90/180/365 days to surface how often discoveries actually hit their
// targets — honest feedback on whether the discovery engine is earning its
// keep vs. just picking lottery tickets.

import mongoose from "mongoose";

const ThesisSchema = new mongoose.Schema(
  {
    bullCase: { type: String, default: "" },
    killThesis: { type: String, default: "" },
    priceTarget: { type: Number, default: null },
    horizonMonths: { type: Number, default: 12 },
    conviction: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    catalysts: { type: [String], default: [] },
    sources: { type: [{ title: String, url: String }], default: [], _id: false },
  },
  { _id: false }
);

// Multi-factor "high-conviction" analysis (additive — only populated by the
// high-conviction screen, never by the legacy scan). Every sub-score is 0-100
// with the data points that produced it, so the score is fully transparent.
const FactorSchema = new mongoose.Schema(
  {
    score: { type: Number, default: null },      // 0-100, null = not assessable
    weight: { type: Number, default: 0 },         // its weight in the blend (risk-mode dependent)
    contributors: { type: [String], default: [] },// human-readable "what moved this"
  },
  { _id: false }
);

// Rules-based projection (entry/target/stop + projected ROI). Mechanical
// asymmetric-R:R projection off the ATR stop — not a forecast.
const ProjectionSchema = new mongoose.Schema(
  {
    entryZone: { type: String, default: "" },
    target: { type: Number, default: null },
    stop: { type: Number, default: null },
    projectedRoiPct: { type: Number, default: null },
    downsidePct: { type: Number, default: null },
    timeframe: { type: String, default: "" },
    rr: { type: Number, default: null },
    basis: { type: String, default: "" },
  },
  { _id: false }
);

const MultiFactorSchema = new mongoose.Schema(
  {
    riskMode: { type: String, enum: ["conservative", "balanced", "aggressive", "speculative"], default: "balanced" },
    // 0-100 blended, transparent score computed in code from the 6 modules
    weightedScore: { type: Number, default: null },
    confidence: { type: Number, default: null },  // 0-100 — driven by data completeness + evidence agreement
    factors: {
      fundamentals: { type: FactorSchema, default: () => ({}) },
      momentum: { type: FactorSchema, default: () => ({}) },
      technical: { type: FactorSchema, default: () => ({}) },
      catalysts: { type: FactorSchema, default: () => ({}) },
      sentiment: { type: FactorSchema, default: () => ({}) },
      riskControl: { type: FactorSchema, default: () => ({}) },
    },
    riskRating: { type: String, enum: ["Low", "Medium", "High", "Speculative"], default: "Medium" },
    bullCase: { type: String, default: "" },
    bearCase: { type: String, default: "" },
    keyCatalysts: { type: [String], default: [] },
    watchZone: { type: String, default: "" },        // suggested watch/buy zone (text, native ccy)
    stopLevel: { type: String, default: "" },         // stop-loss / invalidation level (text)
    timeHorizon: { type: String, enum: ["short-term", "medium-term", "long-term"], default: "medium-term" },
    projection: { type: ProjectionSchema, default: null },
    whyBeatOthers: { type: String, default: "" },
    whatProvesWrong: { type: String, default: "" },
    hypePenaltyApplied: { type: Boolean, default: false },
    // Missing/stale data the score had to work around (transparency)
    dataFlags: { type: [String], default: [] },
    sources: { type: [{ title: String, url: String }], default: [], _id: false },
  },
  { _id: false }
);

const StocksDiscoveryCandidateSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    ticker: { type: String, required: true, uppercase: true, trim: true, index: true },
    name: { type: String, default: "" },
    sector: { type: String, default: "" },
    industry: { type: String, default: "" },
    exchange: { type: String, default: "" },
    marketCap: { type: Number, default: null },
    priceAtDiscovery: { type: Number, default: null },
    currencyAtDiscovery: { type: String, default: "USD" },
    // Composite score 0-100 — how strongly the candidate clears the
    // multi-bagger screen criteria
    score: { type: Number, default: 0 },
    // Raw signals that fed the score, for transparency
    signals: {
      revenueGrowthPct: { type: Number, default: null },
      grossMarginPct: { type: Number, default: null },
      operatingMarginPct: { type: Number, default: null },
      netDebtToEquity: { type: Number, default: null },
      insiderBuying: { type: Boolean, default: false },
      cashRunwayMonths: { type: Number, default: null },
      shortFloatPct: { type: Number, default: null },
    },
    // AI-written investment thesis (legacy scan)
    thesis: { type: ThesisSchema, default: () => ({}) },
    // Multi-factor high-conviction analysis (additive; only the new screen sets this)
    multiFactor: { type: MultiFactorSchema, default: null },
    // Mosaic Intelligence (additive) — public-data signal aggregation. Loosely
    // typed; the shape is validated/sanitized in buildMosaicForResult().
    mosaic: { type: mongoose.Schema.Types.Mixed, default: null },
    // Moonshot 10x analysis (additive) — asymmetric-upside output. Loosely
    // typed; shape is validated/sanitized in buildMoonshotResult().
    moonshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // User actions
    starred: { type: Boolean, default: false },
    dismissed: { type: Boolean, default: false },
    addedToPortfolio: { type: Boolean, default: false },
    // Tracking
    scanDate: { type: Date, default: Date.now, index: true },
    lastPriceCheckedAt: { type: Date, default: null },
    lastPrice: { type: Number, default: null },
    lastOutcomeCheckAt: { type: Date, default: null },
    // Running peak / drawdown since tracking began (point-in-time, captured by
    // the daily outcome tracker — regardless of any action taken on the name)
    peakPrice: { type: Number, default: null },
    peakPct: { type: Number, default: null },
    peakAt: { type: Date, default: null },
    troughPrice: { type: Number, default: null },
    troughPct: { type: Number, default: null },
    troughAt: { type: Date, default: null },
    // Outcome buckets — frozen at maturity by the daily outcome tracker
    outcome30d: { type: { pct: Number, dollars: Number, atPrice: Number }, default: null, _id: false },
    outcome90d: { type: { pct: Number, dollars: Number, atPrice: Number }, default: null, _id: false },
    outcome180d: { type: { pct: Number, dollars: Number, atPrice: Number }, default: null, _id: false },
    outcome365d: { type: { pct: Number, dollars: Number, atPrice: Number }, default: null, _id: false },
  },
  { timestamps: true }
);

// One candidate per (email, ticker, scanDate) — re-scans on different days
// create new rows so we can track timing of when the AI first surfaced a name.
StocksDiscoveryCandidateSchema.index({ email: 1, ticker: 1, scanDate: 1 }, { unique: true });

const StocksDiscoveryCandidate =
  mongoose.models.StocksDiscoveryCandidate ||
  mongoose.model("StocksDiscoveryCandidate", StocksDiscoveryCandidateSchema);

export default StocksDiscoveryCandidate;
