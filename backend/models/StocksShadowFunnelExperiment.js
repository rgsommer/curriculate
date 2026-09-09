// StocksShadowFunnelExperiment
//
// P3 (2026-09-09) — durable state for a shadow-funnel EXPERIMENT run.
// The per-candidate rows live in StocksShadowFunnelRun; this
// collection tracks the run itself so a crash mid-way is visible.
//
// One row per (pickDate, funnel). Never overwritten silently once a
// terminal status is reached — a re-run creates a new attempt (attemptN
// increments).

import mongoose from "mongoose";

const ExperimentSchema = new mongoose.Schema(
  {
    pickDate: { type: String, required: true, index: true },
    funnel: { type: String, required: true, index: true }, // narrow | medium | wide
    attempt: { type: Number, default: 1 },
    status: { type: String, enum: ["PENDING", "RUNNING", "COMPLETE", "FAILED"], default: "PENDING", index: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    candidateCount: { type: Number, default: 0 },
    scoredCount: { type: Number, default: 0 },
    errorMessage: { type: String, default: null },
    engineVersion: { type: String, default: null },
    trigger: { type: String, default: null }, // e.g. "briefing-cron" | "manual"
  },
  { timestamps: true }
);

ExperimentSchema.index({ pickDate: 1, funnel: 1, attempt: 1 }, { unique: true });

const StocksShadowFunnelExperiment = mongoose.model("StocksShadowFunnelExperiment", ExperimentSchema);
export default StocksShadowFunnelExperiment;
