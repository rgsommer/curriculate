// StocksCatalystEvent
//
// P2.5 (2026-09-09) — structured catalyst events. A catalyst is a
// news/filing item classified into one of the categories the P2.5
// spec §4 lists. The classifier records the SOURCE, DATE, EVIDENCE
// snippet, and materiality score so the quantitative engine (not the
// LLM) decides how much a catalyst contributes to a candidate's OQ.
//
// The classifier itself is deterministic keyword-based today
// (stocksCatalystClassifier.js); an LLM enrichment pass can update
// existing rows in place to refine categoryConfidence + materiality
// without changing the row's identity. Row identity is
// (ticker, source, eventDate, sourceId) — sourceId is FMP's article
// id when present, else a hash of source+headline.

import mongoose from "mongoose";

const CATEGORIES = [
  "EARNINGS_GUIDANCE",
  "MAJOR_CONTRACT",
  "REGULATORY_APPROVAL",
  "PRODUCT_COMMERCIALIZATION",
  "MA_SPECIAL_SITUATION",
  "CAPITAL_RETURN",
  "MATERIAL_MARGIN_INFLECTION",
  "INDUSTRY_DEMAND_INFLECTION",
  "OTHER_MATERIAL",
  "NEWS_NOISE",
];
export { CATEGORIES as CATALYST_CATEGORIES };

const CatalystSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, index: true },
    source: { type: String, required: true }, // "fmp-news" | "sec-8k" | "press-release" | ...
    sourceId: { type: String, required: true },
    eventDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    headline: { type: String, default: null },
    url: { type: String, default: null },

    category: { type: String, enum: CATEGORIES, default: "OTHER_MATERIAL", index: true },
    // 0..1 — deterministic classifier's confidence in the category.
    // LLM enrichment (future) may overwrite with a better estimate.
    categoryConfidence: { type: Number, default: 0.5 },
    // 0..100 — how MATERIAL this event is for the company itself.
    // High materiality: earnings guidance change, major contract
    // relative to company size, PDUFA approval. Low: routine analyst
    // note, ordinary product launch, social-media excitement.
    materialityScore: { type: Number, default: 0 },
    // Short evidence snippet — first 200 chars of the underlying text.
    evidence: { type: String, default: null },

    // Optional structured extractions (contract size %, guidance
    // delta, regulator name, deal counterparty). Populated on
    // best-effort basis by the classifier.
    extras: { type: mongoose.Schema.Types.Mixed, default: {} },

    classifiedBy: { type: String, default: "deterministic-keyword-v1" },
    classifiedAt: { type: Date, default: Date.now },
    // P2.6: canonical dedupe key so the same corporate event covered
    // by many outlets collapses to one row. Format documented in
    // stocksCatalystIngest.dedupeKey.
    dedupeKey: { type: String, default: null, index: true },
    sourceDate: { type: String, default: null },
  },
  { timestamps: true }
);

CatalystSchema.index({ ticker: 1, source: 1, sourceId: 1 }, { unique: true });
CatalystSchema.index({ ticker: 1, eventDate: -1 });

const StocksCatalystEvent = mongoose.model("StocksCatalystEvent", CatalystSchema);
export default StocksCatalystEvent;
