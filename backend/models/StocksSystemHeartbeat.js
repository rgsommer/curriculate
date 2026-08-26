// backend/models/StocksSystemHeartbeat.js
//
// Single-doc-per-named-schedule heartbeat — the per-minute stocks-briefing
// tick stamps this on every fire, so the /briefing-diagnostics endpoint can
// tell "the scheduler is running" from "the scheduler is dead" instantly.

import mongoose from "mongoose";

const StocksSystemHeartbeatSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // e.g. "daily-briefing-tick"
    lastTickAt: { type: Date, default: null },
    lastTickDueCount: { type: Number, default: null },
    // Free-form last-run summary (schema-less so different crons can
    // stamp their own shape without model changes). External nomination
    // sync uses this to persist {tickersScanned, nominationsInserted,
    // nominationsSkippedDup, elapsedMs}; outcome pass uses {checked,
    // frozen, skipped, elapsedMs}. The diagnostics endpoint reads
    // whatever's here and displays it verbatim.
    lastRunSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const StocksSystemHeartbeat =
  mongoose.models.StocksSystemHeartbeat ||
  mongoose.model("StocksSystemHeartbeat", StocksSystemHeartbeatSchema);

export default StocksSystemHeartbeat;
