// backend/models/StocksInsiderTransaction.js
//
// Persistent log of individual SEC Form 4 insider transactions ingested
// from EDGAR. One document per (accessionNumber, transactionIndex) so
// filings with multiple non-derivative rows land as separate rows.
//
// Insider transactions have real longitudinal value — the same insider's
// buying pattern across multiple quarters is signal — so we DO persist
// rather than treat as a cache. Cluster detection runs across a rolling
// 30-day window over these rows.

import mongoose from "mongoose";

const StocksInsiderTransactionSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, uppercase: true, index: true },
    cik: { type: String, required: true }, // 10-digit padded
    accessionNumber: { type: String, required: true, index: true },
    insiderName: { type: String, default: "" },
    insiderRole: {
      type: String,
      enum: ["CEO", "CFO", "COO", "CTO", "Director", "10%_holder", "Officer", "Other"],
      default: "Other",
    },
    // P=purchase, S=sale, A=grant, D=disposition, F=tax-payment,
    // M=option-exercise, G=gift, X=option-exercise, C=conversion.
    transactionCode: { type: String, required: true },
    sharesTraded: { type: Number, default: 0 },
    pricePerShare: { type: Number, default: null },
    totalValueUsd: { type: Number, default: 0 },
    transactionDate: { type: Date, required: true, index: true },
    filingDate: { type: Date, required: true },
    isDerivative: { type: Boolean, default: false },
    // A=acquired, D=disposed — captured verbatim from the XML.
    acquiredDisposed: { type: String, enum: ["A", "D", null], default: null },
    formUrl: { type: String, default: "" },
    fetchedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// A single filing can carry multiple transaction rows; the pair
// (accessionNumber, transactionDate + code + shares) uniquely identifies
// each. accessionNumber alone is not unique (many rows per filing) so we
// use a compound uniqueness key that tolerates re-ingestion.
StocksInsiderTransactionSchema.index(
  { accessionNumber: 1, transactionDate: 1, transactionCode: 1, sharesTraded: 1, insiderName: 1 },
  { unique: true }
);
StocksInsiderTransactionSchema.index({ ticker: 1, transactionDate: -1 });

export default mongoose.models.StocksInsiderTransaction
  || mongoose.model("StocksInsiderTransaction", StocksInsiderTransactionSchema);
