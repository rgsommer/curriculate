// StocksPositionLedgerEntry
//
// P3 (2026-09-09) — canonical performance ledger. One row per opened
// position (an atomic BUY→SELL round-trip, or an open BUY still held).
// Reconstructed FIFO from StocksTradeJournal + StocksAdviceRec +
// StocksPortfolioSnapshot. Never fabricates missing detail: every row
// stamps a `dataQuality` status ∈ { COMPLETE, PARTIAL, UNATTRIBUTABLE }.
//
// Rows are idempotent per (email, ticker, account, entryDate, brokerRef)
// so a re-run of the reconstruction cron overwrites rather than duplicates.

import mongoose from "mongoose";

const LedgerEntrySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    ticker: { type: String, required: true, index: true },
    account: { type: String, default: null },
    sleeve: { type: String, default: null, index: true },
    sector: { type: String, default: null, index: true },
    industry: { type: String, default: null },

    // Entry side
    entryDate: { type: Date, required: true, index: true },
    entryPrice: { type: Number, default: null },
    entryShares: { type: Number, default: null },
    entryCurrency: { type: String, default: null },
    entryFx: { type: Number, default: null },

    // Exit side (null for open positions)
    exitDate: { type: Date, default: null, index: true },
    exitPrice: { type: Number, default: null },
    exitShares: { type: Number, default: null },
    exitFx: { type: Number, default: null },

    // Realized / unrealized
    realizedPnLNative: { type: Number, default: null },
    realizedPnLCad: { type: Number, default: null },
    unrealizedPnLNative: { type: Number, default: null },
    unrealizedPnLCad: { type: Number, default: null },

    // Fees / commissions if known (aggregated across BUY + SELL legs).
    // P3.5: feeSource stamps whether we have ACTUAL broker fills,
    // ESTIMATED per-broker defaults, or UNKNOWN.
    feesEstimatedNative: { type: Number, default: 0 },
    feesCad: { type: Number, default: 0 },
    feeSource: {
      type: String,
      enum: ["ACTUAL", "ESTIMATED", "UNKNOWN"],
      default: "ESTIMATED",
    },
    feeEstimateMethods: { type: [String], default: [] },

    // Full-value CAD valuations (P3.5 — computed via computeCadPnl,
    // NOT native × exit FX). Present for both entry and exit sides.
    entryValueCad: { type: Number, default: null },
    exitValueCad: { type: Number, default: null },

    // Holding period + attribution linkage
    holdingPeriodDays: { type: Number, default: null },
    recommendationId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    decisionEngineVersion: { type: String, default: null },
    pickEngineVersion: { type: String, default: null },

    // Status flags
    isOpen: { type: Boolean, default: false, index: true },
    isPartial: { type: Boolean, default: false }, // this ledger row represents a partial exit
    brokerRef: { type: String, default: null },   // for FIFO tie-back

    // dataQuality — the operator can trust any COMPLETE row's numbers.
    // PARTIAL means some prices/dates were interpolated from snapshots.
    // UNATTRIBUTABLE means we couldn't map the trade back cleanly and
    // it should NOT contribute to summary alpha computations.
    dataQuality: {
      type: String,
      enum: ["COMPLETE", "PARTIAL", "UNATTRIBUTABLE"],
      default: "PARTIAL",
      index: true,
    },
    // Which fields were interpolated / missing (audit trail).
    missingFields: { type: [String], default: [] },
    reconstructionNotes: { type: String, default: null },

    // Passive-benchmark comparators computed on demand and cached.
    benchmarkTicker: { type: String, default: null },
    benchmarkReturnPctMatched: { type: Number, default: null },
    securityReturnPct: { type: Number, default: null },
    matchedAlphaPct: { type: Number, default: null },

    // FX decomposition (CAD investor holding USD security). P3.5:
    // interactionPct is the r_local × r_fx cross term so the three
    // pieces reconcile exactly to combinedCadReturnPct.
    localReturnPct: { type: Number, default: null },
    fxReturnPct: { type: Number, default: null },
    interactionPct: { type: Number, default: null },
    combinedCadReturnPct: { type: Number, default: null },

    reconstructedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

LedgerEntrySchema.index({ email: 1, ticker: 1, account: 1, entryDate: 1, brokerRef: 1 }, { unique: true, sparse: true });

const StocksPositionLedgerEntry = mongoose.model("StocksPositionLedgerEntry", LedgerEntrySchema);
export default StocksPositionLedgerEntry;
