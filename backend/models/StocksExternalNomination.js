// backend/models/StocksExternalNomination.js
//
// External Recommendation / Conviction Discovery Layer — global-scoped
// nominations from third-party signals (INSIDER Form 4 clusters,
// SELL_SIDE FMP grades/revisions, INSTITUTIONAL 13F changes, and later
// EDITORIAL/QUANTITATIVE adapters).
//
// KEY CONTRACT:
//   • Nominations NEVER directly create a BUY. They contribute at most
//     +5 to enhancedComposite (externalAdjustment cap), on top of the
//     UNCHANGED base composite. Every hard gate (R/R, price-verify, MTF,
//     sleeve, canonical, funding, kill-switch) is preserved.
//   • Global scope (one Berkshire buy = one signal for every user, not
//     one per email) — different from user-scoped StocksDiscoveryCandidate.
//   • Category-typed so 5 firms upgrading same day counts as ONE
//     SELL_SIDE signal, not five. Confirmation requires DIFFERENT
//     categories (INSIDER + SELL_SIDE + INSTITUTIONAL), not source count.
//   • Signed strength — INCREASE / DECREASE / EXIT and UPGRADE /
//     DOWNGRADE / TARGET_RAISE / TARGET_CUT / INITIATION distinguished,
//     so a Cathie Wood EXIT is negative even though it's an institutional
//     signal.
//   • Provenance on every numeric field: { value, unit, currency, asOf,
//     source, sourceType } so external prose never overwrites canonical
//     market data.
//   • Forward-return buckets mirror StocksDiscoveryCandidate so the
//     existing discovery-outcome tracker can freeze horizons unchanged.
//
// Adapter contract for future sources: implement {sourceKey, category,
// nominatedAt, publishedAt, strength(signed), citation, provenancedFields}
// and the aggregator + tracker inherit the ranking and forward-return
// pipeline with zero schema changes.

import mongoose from "mongoose";

// The six-plus category taxonomy from the design spec. External
// agreement across DIFFERENT categories is the confluence signal we
// care about; agreement WITHIN one category is deduplicated so 5 sites
// syndicating one upgrade collapse to one SELL_SIDE observation.
export const NOMINATION_CATEGORIES = [
  "EDITORIAL",           // Motley Fool / Zacks / Barron's / Seeking Alpha — via web_search only, later
  "SELL_SIDE",           // Analyst upgrades/downgrades/target revisions (FMP grades)
  "QUANTITATIVE",        // Zacks Rank / rules-based screens — later, needs API
  "INSTITUTIONAL",       // 13F whale filings (Berkshire, Ackman, Burry, etc.)
  "INSIDER",             // SEC Form 4 cluster buys / notable solo insider purchases
  "FUNDAMENTAL",         // Earnings estimate revisions, unusual growth — later
  "TECHNICAL_MOMENTUM",  // External TA services — later
  "ALTERNATIVE_DATA",    // Patents / job postings / satellite / etc. — later
];

// Action-type taxonomy inside each category. The strength calc uses
// these to sign the contribution (EXIT is negative, UPGRADE positive,
// TARGET_CUT negative). Keeping the enum explicit means downstream
// analytics can distinguish a Berkshire NEW_POSITION from a 20%
// INCREASE from a full EXIT.
export const NOMINATION_ACTIONS = [
  // Institutional (13F)
  "NEW_POSITION", "INCREASE", "DECREASE", "EXIT",
  // Sell-side (analyst)
  "UPGRADE", "DOWNGRADE", "TARGET_RAISE", "TARGET_CUT", "INITIATION",
  // Insider (Form 4)
  "CLUSTER_BUY", "NOTABLE_BUY", "CLUSTER_SELL", "NOTABLE_SELL",
  // Editorial / other
  "RECOMMENDATION", "REVISED_RECOMMENDATION", "COVERAGE",
];

// Provenanced-numeric shape reused across every external numeric datum.
// {value, unit, currency, asOf, source, sourceType} — never touches the
// canonical market-data path; the audit gate can spot leaks.
const ProvenancedNumberSchema = new mongoose.Schema({
  value: { type: Number, required: true },
  unit: { type: String, default: null },          // "USD" / "shares" / "pct" / "$/share"
  currency: { type: String, default: null },
  asOf: { type: Date, default: null },
  source: { type: String, default: null },        // "fmp-grades" / "sec-form4" / "13f-berkshire"
  sourceType: { type: String, default: null },    // matches NOMINATION_CATEGORIES
}, { _id: false });

const CitationSchema = new mongoose.Schema({
  title: { type: String, default: null },
  url: { type: String, default: null },
  publisher: { type: String, default: null },
}, { _id: false });

// Forward-return bucket. Frozen by the existing discovery outcome
// tracker at each horizon; before freeze the fields are null so we
// can distinguish "no return computed yet" from "0% return".
const OutcomeBucketSchema = new mongoose.Schema({
  price: { type: Number, default: null },
  return_pct: { type: Number, default: null },
  benchmark_return_pct: { type: Number, default: null },
  excess_return_pct: { type: Number, default: null },
  frozenAt: { type: Date, default: null },
}, { _id: false });

const StocksExternalNominationSchema = new mongoose.Schema({
  // Identity — global, not user-scoped.
  ticker: { type: String, required: true, uppercase: true, index: true },
  companyName: { type: String, default: null },
  exchange: { type: String, default: null },
  currency: { type: String, default: null },

  // Source classification.
  sourceKey: { type: String, required: true, index: true },  // "sec-form4-cluster" / "fmp-grades" / "13f-berkshire"
  sourceCategory: {                                           // taxonomy — governs dedup + confluence
    type: String,
    enum: NOMINATION_CATEGORIES,
    required: true,
    index: true,
  },
  action: { type: String, enum: NOMINATION_ACTIONS, default: null },

  // Signed strength — negative for EXIT / DOWNGRADE / TARGET_CUT.
  // Raw score from adapter (before category dedup and freshness decay).
  strengthRaw: { type: Number, default: 0 },

  // Two timestamps — CRITICAL to distinguish. publishedAt = when the
  // source's underlying event happened (e.g. Form 4 transaction date,
  // 13F quarter-end, upgrade press-release date). discoveredAt = when
  // Stocks Advisor ingested it. Freshness decay measures against
  // publishedAt so a 45-day-lag 13F never masquerades as recent.
  publishedAt: { type: Date, default: null, index: true },
  discoveredAt: { type: Date, default: () => new Date(), index: true },

  // Price at nomination — provenanced. Never used to override the
  // canonical current price; only for source-performance forward-return
  // math (nominated at $X, 30d later $Y).
  priceAtNomination: { type: ProvenancedNumberSchema, default: null },
  targetAtNomination: { type: ProvenancedNumberSchema, default: null },

  // Human-readable + machine-referenceable citation.
  thesis: { type: String, default: null, maxlength: 2000 },
  catalyst: { type: String, default: null, maxlength: 500 },
  statedHorizon: { type: String, default: null },
  citation: { type: CitationSchema, default: null },

  // Adapter-specific detail (e.g. which insider role, which whale CIK,
  // which analyst firm). Kept as Mixed so adapters can enrich without
  // schema changes.
  adapterDetail: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Attribution flags — set by the aggregator at read time (against
  // the caller's internal universe / current Discover pool). Frozen
  // once at first observation.
  externallyDiscovered: { type: Boolean, default: false },
  alreadyInInternalUniverse: { type: Boolean, default: false },
  externalConfirmed: { type: Boolean, default: false },   // internal & external agree
  externalContradicted: { type: Boolean, default: false }, // internal negative, external positive

  // Forward-return buckets. Frozen by the discovery outcome tracker
  // via the same horizon-freeze loop it already runs — the tracker
  // just iterates a second collection now.
  outcome1d:   { type: OutcomeBucketSchema, default: null },
  outcome7d:   { type: OutcomeBucketSchema, default: null },
  outcome30d:  { type: OutcomeBucketSchema, default: null },
  outcome90d:  { type: OutcomeBucketSchema, default: null },
  outcome180d: { type: OutcomeBucketSchema, default: null },
  outcome365d: { type: OutcomeBucketSchema, default: null },
  maxFavourableExcursionPct: { type: Number, default: null },
  maxAdverseExcursionPct: { type: Number, default: null },

  // Freshness — refreshed by the tracker; older nominations decay in
  // the strength calc so a 90-day-old upgrade doesn't influence today.
  lastPriceCheckAt: { type: Date, default: null },
  lastPrice: { type: Number, default: null },
}, {
  timestamps: true,
  collection: "stocks_external_nominations",
});

// Composite index — a source can nominate the same ticker multiple
// times (e.g. Berkshire increases stake again next quarter). Dedup key
// includes publishedAt so the SAME event isn't stored twice, but a
// later event on the same ticker/source becomes a NEW nomination.
StocksExternalNominationSchema.index(
  { ticker: 1, sourceKey: 1, publishedAt: 1 },
  { unique: true, sparse: true }
);
StocksExternalNominationSchema.index({ sourceCategory: 1, publishedAt: -1 });
StocksExternalNominationSchema.index({ publishedAt: -1 });

export default mongoose.models.StocksExternalNomination
  || mongoose.model("StocksExternalNomination", StocksExternalNominationSchema);
