// backend/models/StocksInstitutional13F.js
//
// One document per (cik, quarterEnd) — the full holdings snapshot from
// a whale's 13F-HR filing at SEC EDGAR. Institutional investment
// managers with $100M+ AUM must file 13F within 45 days of quarter-end,
// so the data is authoritative but chronically lagged. We store the
// full holdings array plus quarter-over-quarter delta flags
// (isNewPosition, changePct) computed once at ingest so the briefing
// formatter can pick out "just added" / "increased by 40%" / "liquidated"
// without re-querying.
//
// Ticker is best-effort resolved from CUSIP via FMP; missing ticker
// is expected for smaller / OTC names and doesn't block persistence —
// the raw CUSIP + company name still identifies the holding.

import mongoose from "mongoose";

const HoldingSchema = new mongoose.Schema(
  {
    cusip: { type: String, required: true },
    ticker: { type: String, default: null, uppercase: true }, // may be null
    companyName: { type: String, default: "" },
    sharesHeld: { type: Number, default: 0 },
    valueUsd: { type: Number, default: 0 },
    // Delta flags computed at ingest by diffing vs the same whale's
    // prior-quarter filing. isNewPosition = true means the cusip
    // wasn't in the prior filing at all; changePct = null means we
    // had no prior baseline to diff against.
    isNewPosition: { type: Boolean, default: false },
    changePct: { type: Number, default: null },
  },
  { _id: false }
);

const StocksInstitutional13FSchema = new mongoose.Schema(
  {
    cik: { type: String, required: true, index: true }, // 10-digit padded
    whaleName: { type: String, required: true },
    quarterEnd: { type: Date, required: true, index: true },
    filedAt: { type: Date, required: true },
    accessionNumber: { type: String, required: true, unique: true },
    holdings: { type: [HoldingSchema], default: [] },
    fetchedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// One 13F per (cik, quarterEnd). accession is separately unique above.
StocksInstitutional13FSchema.index({ cik: 1, quarterEnd: -1 }, { unique: true });

export default mongoose.models.StocksInstitutional13F
  || mongoose.model("StocksInstitutional13F", StocksInstitutional13FSchema);
