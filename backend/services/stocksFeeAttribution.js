// backend/services/stocksFeeAttribution.js
//
// P3.5 (2026-09-09) — per-leg fee accounting with an explicit source.
//
// Never claim broker truth we don't have. Each fee number carries:
//   feeSource        = "ACTUAL" | "ESTIMATED" | "UNKNOWN"
//   feeEstimateMethod = "cibc-ie-default" | "questrade-eq-default" | "flat-6.95" | null
//
// TradeJournal today does NOT persist fee per leg, so ACTUAL is only
// available if the caller supplies it. Otherwise we ESTIMATE per
// executed leg using a per-account default. UNKNOWN is reserved for
// legs with no account tag AND no leg-side info.

const DEFAULT_ESTIMATE_NATIVE = Number(process.env.STOCKS_FEE_DEFAULT_NATIVE || 6.95);

// Per-account estimate table. Ops can override via env; the shipped
// defaults reflect the two brokers most commonly held on this book.
const ACCOUNT_ESTIMATES = {
  "cibc-ie":   { native: 6.95, method: "cibc-ie-default" },
  "questrade": { native: 4.95, method: "questrade-eq-default" },
};

// PUBLIC — estimate the fee for one executed leg.
//   leg: { side: "BUY"|"SELL"|"DEPOSIT"|"WITHDRAW", currency, shares, ... }
//   ctx: { brokerCode?: string, actualFeeNative?: number, actualFeeCurrency? }
export function estimateLegFee(leg, ctx = {}) {
  // No fees on deposits / withdrawals.
  if (!leg || leg.side === "DEPOSIT" || leg.side === "WITHDRAW") {
    return { feeNative: 0, feeCurrency: leg?.currency || "CAD", feeSource: "ACTUAL", feeEstimateMethod: null };
  }
  // If the caller has actual — trust it. (Free-trade broker → 0.)
  if (Number.isFinite(ctx.actualFeeNative)) {
    return {
      feeNative: ctx.actualFeeNative,
      feeCurrency: ctx.actualFeeCurrency || leg.currency || "CAD",
      feeSource: "ACTUAL",
      feeEstimateMethod: null,
    };
  }
  // Estimate by broker code where present.
  const broker = String(ctx.brokerCode || "").toLowerCase();
  const est = ACCOUNT_ESTIMATES[broker] || null;
  if (est) {
    return {
      feeNative: est.native,
      feeCurrency: leg.currency || "CAD",
      feeSource: "ESTIMATED",
      feeEstimateMethod: est.method,
    };
  }
  // Default flat estimate.
  return {
    feeNative: DEFAULT_ESTIMATE_NATIVE,
    feeCurrency: leg.currency || "CAD",
    feeSource: "ESTIMATED",
    feeEstimateMethod: "flat-6.95",
  };
}

// PUBLIC — sum fees across multiple legs, carrying the worst source
// (ACTUAL > ESTIMATED > UNKNOWN). Returns total fees in CAD given an
// FX rate for USD-fee conversion.
export function aggregateFees(legFees, { fxUsdCad = 1.37 } = {}) {
  let totalCad = 0;
  let worst = "ACTUAL";
  const rank = { ACTUAL: 0, ESTIMATED: 1, UNKNOWN: 2 };
  for (const f of legFees || []) {
    if (!f) continue;
    const cad = f.feeCurrency === "CAD" ? f.feeNative : f.feeNative * fxUsdCad;
    if (Number.isFinite(cad)) totalCad += cad;
    if (rank[f.feeSource] > rank[worst]) worst = f.feeSource;
  }
  return { totalCad, worstSource: worst };
}
