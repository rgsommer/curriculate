// backend/models/CurrentEventsCache.js
//
// Persistent cache for resolved Current Events tasks. Backed by the in-memory
// Map in currentEventsResolver.js — Mongo lookup is only consulted when the
// in-process cache misses. Keeps resolved stories warm across restarts (per
// CURRENT_EVENTS_PLAN.md §4 cache requirement).
import mongoose from "mongoose";

const { Schema } = mongoose;

const CurrentEventsCacheSchema = new Schema(
  {
    cacheKey:  { type: String, required: true, unique: true, index: true },
    resolved:  { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    sourceUrl: { type: String, default: "" },
    fallbackTier: { type: String, default: "world-news" },
  },
  { timestamps: true },
);

// TTL — Mongo will sweep expired entries automatically (delay tied to expireAfterSeconds: 0 + the expiresAt field)
CurrentEventsCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CurrentEventsCache = mongoose.model("CurrentEventsCache", CurrentEventsCacheSchema);
export default CurrentEventsCache;
