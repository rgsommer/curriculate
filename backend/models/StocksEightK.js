// backend/models/StocksEightK.js
//
// SEC 8-K material-events cache. One doc per unique filing (accessionNumber
// is a globally-unique SEC id, safe as a dedup key). The polling cron
// upserts these; the API/email path reads them. Kept ~90 days.
//
// itemNumbers comes directly from the SEC submissions.json "items" field
// (comma-separated on 8-K rows) — no filing-body parsing needed.

import mongoose from "mongoose";

const StocksEightKSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, uppercase: true, index: true },
    cik: { type: String, required: true }, // 10-digit zero-padded
    accessionNumber: { type: String, required: true, unique: true },
    filedAt: { type: Date, required: true, index: true },
    itemNumbers: { type: [String], default: [] }, // e.g. ["1.01","5.02"]
    itemLabels: { type: [String], default: [] },  // human-readable labels
    highSignal: { type: Boolean, default: false, index: true },
    primaryDocument: { type: String, default: "" },
    url: { type: String, default: "" },
    // Recipients emailed for this filing so we don't double-send if the
    // ticker sits in multiple portfolios.
    emailedTo: { type: [String], default: [] },
  },
  { timestamps: true }
);

StocksEightKSchema.index({ ticker: 1, filedAt: -1 });

export default mongoose.models.StocksEightK || mongoose.model("StocksEightK", StocksEightKSchema);
