// backend/models/StocksRecIntent.js
//
// User-stated intent per recommendation. Deliberately separate from
// the trade journal — which records what the BROKER actually executed
// — so the two can coexist without conflict:
//
//   intent          = what the trader said they'd do (this file)
//   trade journal   = what the broker confirmed (StocksTradeJournal)
//   linkedRecId     = the join key between them, populated by the
//                     poller or the manual "record trade" flow
//
// Rules:
//   • Intents NEVER gate any other flow. The Gmail poller records
//     broker fills regardless of whether the user marked the rec.
//   • One row per (email, recType, recId). Toggling cycles intent
//     through "executed" → "skipped" → null and upserts in place.
//   • recType is a discriminator because rec IDs live in two different
//     collections (StocksAdviceRec vs StocksDailyPick).

import mongoose from "mongoose";

const StocksRecIntentSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    recType: { type: String, enum: ["advice", "daily-pick"], required: true },
    recId: { type: mongoose.Schema.Types.ObjectId, required: true },
    intent: {
      type: String,
      enum: ["executed", "skipped"],
      required: true,
    },
    markedAt: { type: Date, default: Date.now },
    notes: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

// One row per rec — upserts overwrite prior intent.
StocksRecIntentSchema.index(
  { email: 1, recType: 1, recId: 1 },
  { unique: true }
);

// For the compliance service's batched read (intents in the last 90d).
StocksRecIntentSchema.index({ email: 1, markedAt: -1 });

export default mongoose.models.StocksRecIntent ||
  mongoose.model("StocksRecIntent", StocksRecIntentSchema);
