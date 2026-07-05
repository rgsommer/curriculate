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
  },
  { timestamps: true }
);

const StocksSystemHeartbeat =
  mongoose.models.StocksSystemHeartbeat ||
  mongoose.model("StocksSystemHeartbeat", StocksSystemHeartbeatSchema);

export default StocksSystemHeartbeat;
