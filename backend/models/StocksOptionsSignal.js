// backend/models/StocksOptionsSignal.js
//
// Persistent log of options-flow signals detected by stocksOptionsFlow.
// One row per (ticker, signalType, day) — a fresh signal on the same
// ticker the next day gets a new row so the timeline is preserved.
//
// Signal types the spec calls for:
//   unusual_call_volume  — today's option volume >> 20d avg, call-skewed
//   sweep_bullish        — UW-only, single order > $100K notional, ask-side
//   sweep_bearish        — UW-only, single order > $100K notional, bid-side
//   iv_compression       — high IV before a known earnings date (crush setup)
//   put_call_extreme     — dollar C/P ratio ≥ 4× or ≤ 0.25×
//
// `meta` carries source (uw|yahoo), plus signalType-specific detail —
// unusual strikes, dollar volume, expiration, spot price, etc.

import mongoose from "mongoose";

const SIGNAL_TYPES = [
  "unusual_call_volume",
  "sweep_bullish",
  "sweep_bearish",
  "iv_compression",
  "put_call_extreme",
];

const StocksOptionsSignalSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, uppercase: true, index: true },
    signalType: { type: String, enum: SIGNAL_TYPES, required: true },
    strength: { type: Number, min: 0, max: 10, default: 5 },
    source: { type: String, enum: ["uw", "yahoo"], required: true },
    detectedAt: { type: Date, required: true, index: true },
    // signalType-specific payload. Kept as a Mixed Object so we don't
    // need a migration every time UW adds a field.
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Fast lookup: recent signals per ticker
StocksOptionsSignalSchema.index({ ticker: 1, detectedAt: -1 });
// Dedupe: one signal per (ticker, signalType, UTC day) via the app layer.
StocksOptionsSignalSchema.index({ ticker: 1, signalType: 1, detectedAt: -1 });

export default mongoose.models.StocksOptionsSignal
  || mongoose.model("StocksOptionsSignal", StocksOptionsSignalSchema);
