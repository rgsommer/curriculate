// backend/models/StocksPortfolio.js
//
// One document per email. Holds the user's risk tolerance, accounts,
// positions, and FX assumption for the personal stock advisor at /stocks.
//
// Auth is via HMAC session token issued by the frontend's
// /api/stocks/verify-pin route. See backend/routes/stocksPortfolio.js
// for the verification logic.

import mongoose from "mongoose";

// Beneficiary agreement — used when an account holds capital that is actually
// owed to a third party (e.g. Richard's TFSA cash held for his daughter Tamara
// on a 3%-interest agreement, with profit-share at payout and recurring
// inflows from the beneficiary toward shared household expenses).
//
// Math at any point in time:
//   I_owed   = principalCad × interestRatePct/100 × yearsSinceStart
//   profit   = currentAccountValueCad − principalCad
//   share    = max(0, profit) × profitSharePct/100      (only positive profit shared)
//   payout   = principalCad + I_owed + share            (what beneficiary gets if cashed out today)
//   inflows  = sum of recurring inflows since startDate (what beneficiary has paid the user)
//   netCarry = inflows − I_owed                         (positive = beneficiary owes user net)
//
// If carryLosses=true and profit<0, the user absorbs the shortfall: beneficiary
// still gets principal + interest.
const BeneficiaryInflowSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, maxlength: 100 },
    amountCad: { type: Number, required: true, min: 0 },
    frequency: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
  },
  { _id: false }
);

const BeneficiaryAgreementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    name: { type: String, default: "", maxlength: 80 },
    principalCad: { type: Number, default: 0, min: 0 },
    interestRatePct: { type: Number, default: 0, min: 0, max: 100 },
    profitSharePct: { type: Number, default: 0, min: 0, max: 100 },
    carryLosses: { type: Boolean, default: true },
    startDate: { type: Date, default: null },
    inflows: { type: [BeneficiaryInflowSchema], default: [] },
    notes: { type: String, default: "", maxlength: 1000 },
  },
  { _id: false }
);

const AccountSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    // Sweep-account cash held within this brokerage account. Most Canadian
    // brokers (CIBC Investor's Edge, RBC Direct, TD Direct) keep separate
    // USD and CAD cash balances per account.
    cashUsd: { type: Number, default: 0 },
    cashCad: { type: Number, default: 0 },
    // Optional per-account risk override. When null, the portfolio's global
    // riskTolerance applies. Lets the user run an aggressive Non-Spousal
    // alongside a moderate RRSP and a conservative TFSA, for example.
    riskTolerance: {
      type: String,
      enum: ["conservative", "moderate", "aggressive", "speculative", null],
      default: null,
    },
    // When true, this account gets a dedicated block in the daily briefing on
    // the last market day of the month (period P&L, YTD, inception) AND a
    // separate end-of-month email after market close that same day.
    monthlyReportEnabled: { type: Boolean, default: false },
    // Optional beneficiary agreement. See BeneficiaryAgreementSchema comments
    // above for the payout math. Surfaced in monthly reports when enabled.
    beneficiaryAgreement: { type: BeneficiaryAgreementSchema, default: () => ({}) },
  },
  { _id: false }
);

const PositionSchema = new mongoose.Schema(
  {
    acct: { type: String, required: true }, // account.id
    ticker: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, default: "" },
    qty: { type: Number, required: true },
    // Trading currency — the exchange the stock trades on (USD or CAD).
    ccy: { type: String, enum: ["USD", "CAD"], required: true },
    // Settlement currency — which CURRENCY SUB-ACCOUNT actually holds the
    // position. Often equal to ccy, but a USD-listed stock CAN be held in the
    // CAD sub of an RRSP/TFSA (with FX friction on purchase and sale). When
    // null, assume same as ccy.
    subCcy: { type: String, enum: ["USD", "CAD", null], default: null },
    priceUsd: { type: Number, default: null },
    priceCad: { type: Number, default: null },
    costBasisUsd: { type: Number, default: null },
    costBasisCad: { type: Number, default: null },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const StocksPortfolioSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    riskTolerance: {
      type: String,
      enum: ["conservative", "moderate", "aggressive", "speculative"],
      default: null,
    },
    fxUsdCad: { type: Number, default: 1.37 },
    // Real-world trading-cost knobs the AI factors into trade sizing.
    // commissionPerTrade  — flat per-trade fee (CAD) at this user's broker
    //                       (CIBC Investor's Edge = $6.95; RBC Direct = $9.95).
    // fxSpreadPct         — round-trip FX spread when swapping USD↔CAD via
    //                       the broker's currency conversion (typically 1.5%).
    commissionPerTrade: { type: Number, default: 9.95 },
    fxSpreadPct: { type: Number, default: 1.5 },
    // Free-form long-term goals & constraints. Written by the user in their
    // own words ("retire in 2030", "$1K/mo from 2035", "RRSP cap $86K") and
    // injected at the TOP of every AI advice/briefing prompt so the model
    // anchors all recs against the user's stated life-plan, not just the
    // short-term portfolio state.
    goals: { type: String, default: "", maxlength: 5000 },
    // Contribution targets — set by the user. RRSP/RESP/TFSA. Each goal carries
    // an amount + a period ("monthly" or "yearly") so the user can think in
    // whichever cadence matches how they actually contribute. The AI normalizes
    // both to annual under the hood for deadline reasoning (RRSP Mar 1, etc.).
    // Field name kept as `annualContributionGoals` for storage compatibility,
    // but the nested shape supports both periods. Legacy flat numbers are
    // auto-coerced to { amount, period: "yearly" } by the PUT sanitizer.
    annualContributionGoals: {
      rrsp: {
        amount: { type: Number, default: 0 },
        period: { type: String, enum: ["monthly", "yearly"], default: "yearly" },
      },
      resp: {
        amount: { type: Number, default: 0 },
        period: { type: String, enum: ["monthly", "yearly"], default: "yearly" },
      },
      tfsa: {
        amount: { type: Number, default: 0 },
        period: { type: String, enum: ["monthly", "yearly"], default: "yearly" },
      },
    },
    accounts: { type: [AccountSchema], default: [] },
    positions: { type: [PositionSchema], default: [] },
    // Planned withdrawals — "I need $X by date Y" so AI recs can prepare
    // cash and avoid locking it up in long-horizon buys.
    plannedWithdrawals: {
      type: [
        {
          id: { type: String, required: true },
          amount: { type: Number, required: true, min: 0 },
          currency: { type: String, enum: ["USD", "CAD"], required: true },
          targetDate: { type: Date, required: true },
          account: { type: String, default: "" },
          notes: { type: String, default: "", maxlength: 300 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      _id: false,
    },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const StocksPortfolio =
  mongoose.models.StocksPortfolio ||
  mongoose.model("StocksPortfolio", StocksPortfolioSchema);

export default StocksPortfolio;
