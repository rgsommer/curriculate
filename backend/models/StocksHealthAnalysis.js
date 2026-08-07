// backend/models/StocksHealthAnalysis.js
//
// Persisted AI narrative for the Health tab. One document per user;
// upserted on each successful /api/stocks-health/analysis POST. Kept
// as a single doc rather than an append-only log because the narrative
// is always evaluated against the current book — historical narratives
// stop being useful once the portfolio changes materially.

import mongoose from "mongoose";

const StocksHealthAnalysisSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  generatedAt: { type: Date, default: Date.now },
  // Snapshot of the health data at analysis time (allocations, sleeves,
  // overlaps, concentrations, sectorExposure, healthScore). Lets the UI
  // show what the AI was reasoning over — critical for "how did we get
  // this narrative" trust.
  snapshot: { type: mongoose.Schema.Types.Mixed },
  aiNarrative: { type: String, default: "" },
  aiScore: { type: Number, default: null }, // 0-10, model's own view (separate from deterministic healthScore)
  model: { type: String, default: "" },
}, { collection: "stocksHealthAnalyses" });

export default mongoose.models.StocksHealthAnalysis
  || mongoose.model("StocksHealthAnalysis", StocksHealthAnalysisSchema);
