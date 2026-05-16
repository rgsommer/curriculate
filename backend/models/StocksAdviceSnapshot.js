// backend/models/StocksAdviceSnapshot.js
//
// One document per email — holds the latest briefing's parsed advice cards
// so the in-app Advice tab can render the same content the user got in
// their morning email (or just sent via Email Briefing) without spending a
// fresh Anthropic call.
//
// The snapshot is overwritten each time a fresh briefing is generated; it
// does NOT track history. For history, query StocksAdviceRec (the scorecard).
//
// "Update Advice" on the app still runs a fresh AI pass and stores the
// result in component state; the snapshot is just the default-load source.

import mongoose from "mongoose";

const AdviceCardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: "" },
  },
  { _id: false }
);

const StocksAdviceSnapshotSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    generatedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["cron", "on-demand"], default: "cron" },
    advice: { type: [AdviceCardSchema], default: [] },
    sources: { type: [{ title: String, url: String }], default: [], _id: false },
    // Keep the raw briefing markdown so the frontend can offer a "view as
    // email" mode in addition to the cards view.
    markdown: { type: String, default: "" },
  },
  { timestamps: true }
);

const StocksAdviceSnapshot =
  mongoose.models.StocksAdviceSnapshot ||
  mongoose.model("StocksAdviceSnapshot", StocksAdviceSnapshotSchema);

export default StocksAdviceSnapshot;
