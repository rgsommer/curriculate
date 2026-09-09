// backend/services/stocksFxDecomposition.js
//
// P3.5 (2026-09-09) — correct USD/CAD P&L math + FX decomposition.
//
// The right formula for a USD position held by a CAD investor:
//   entryValueCad = shares × entryPriceUsd × entryFxCadPerUsd
//   exitValueCad  = shares × exitPriceUsd  × exitFxCadPerUsd
//   realizedPnLCad = exitValueCad − entryValueCad − feesCad
//
// Decomposition of the LOCAL-CURRENCY CAD return into
// local security effect + FX effect + interaction effect. Under
// arithmetic (not log) attribution, these three reconcile exactly to
// the combined CAD return:
//
//   (1 + r_local) × (1 + r_fx) − 1
//     = r_local + r_fx + r_local × r_fx
//     = LOCAL   + FX   + INTERACTION
//
// PUBLIC:
//   computeCadPnl({ shares, entryPriceNative, exitPriceNative, currency,
//                   entryFxCadPerUsd, exitFxCadPerUsd, feesCad })
//     → { entryValueCad, exitValueCad, realizedPnLCad,
//         localReturnPct, fxReturnPct, interactionPct, combinedCadReturnPct,
//         reconcilesTo: number }
//
//   decomposePartialExit(legs)
//     → aggregates multiple partial exits (each with its own FX) into
//       one weighted decomposition.

// PUBLIC — one-leg CAD P&L + decomposition.
export function computeCadPnl({
  shares, entryPriceNative, exitPriceNative,
  currency = "USD",
  entryFxCadPerUsd = null, exitFxCadPerUsd = null,
  feesCad = 0,
}) {
  const ccy = String(currency || "USD").toUpperCase();
  if (!(shares > 0) || !(entryPriceNative > 0) || !(exitPriceNative > 0)) {
    return {
      entryValueCad: null, exitValueCad: null, realizedPnLCad: null,
      localReturnPct: null, fxReturnPct: null, interactionPct: null,
      combinedCadReturnPct: null, reconcilesTo: null,
    };
  }
  const entryFx = ccy === "CAD" ? 1 : Number(entryFxCadPerUsd);
  const exitFx  = ccy === "CAD" ? 1 : Number(exitFxCadPerUsd);
  if (ccy === "USD" && (!(entryFx > 0) || !(exitFx > 0))) {
    return {
      entryValueCad: null, exitValueCad: null, realizedPnLCad: null,
      localReturnPct: null, fxReturnPct: null, interactionPct: null,
      combinedCadReturnPct: null, reconcilesTo: null,
      note: "missing-fx",
    };
  }
  const entryValueCad = shares * entryPriceNative * entryFx;
  const exitValueCad  = shares * exitPriceNative  * exitFx;
  const realizedPnLCad = exitValueCad - entryValueCad - (Number(feesCad) || 0);
  const rLocal = (exitPriceNative - entryPriceNative) / entryPriceNative;
  const rFx    = ccy === "CAD" ? 0 : (exitFx - entryFx) / entryFx;
  const rInt   = rLocal * rFx;
  const combined = (1 + rLocal) * (1 + rFx) - 1;
  const localReturnPct    = rLocal * 100;
  const fxReturnPct       = rFx * 100;
  const interactionPct    = rInt * 100;
  const combinedCadReturnPct = combined * 100;
  return {
    entryValueCad, exitValueCad, realizedPnLCad,
    localReturnPct, fxReturnPct, interactionPct, combinedCadReturnPct,
    // Reconciliation sum — should equal combinedCadReturnPct within
    // floating-point noise. Callers assert |Δ| < 1e-6.
    reconcilesTo: localReturnPct + fxReturnPct + interactionPct,
  };
}

// PUBLIC — aggregate partial exits at different FX into one blended
// row. Each partial has its own share count, exit price, and exit FX.
// The entry side is shared. Realized PnL sums; returns are share-
// weighted at exit value.
export function decomposePartialExit({
  entryShares, entryPriceNative, entryFxCadPerUsd,
  currency = "USD", feesCadPerLeg = 0,
  exits, // [{ shares, exitPriceNative, exitFxCadPerUsd }]
}) {
  if (!Array.isArray(exits) || exits.length === 0) {
    return { realizedPnLCad: 0, weightedExitValueCad: 0, entryValueCad: null, exits: [] };
  }
  const perLeg = exits.map(e => computeCadPnl({
    shares: e.shares,
    entryPriceNative, exitPriceNative: e.exitPriceNative,
    currency,
    entryFxCadPerUsd, exitFxCadPerUsd: e.exitFxCadPerUsd,
    feesCad: feesCadPerLeg,
  }));
  const realizedPnLCad = perLeg.reduce((s, r) => s + (r.realizedPnLCad || 0), 0);
  const entryValueCad = perLeg.reduce((s, r) => s + (r.entryValueCad || 0), 0);
  const exitValueCad = perLeg.reduce((s, r) => s + (r.exitValueCad || 0), 0);
  return {
    realizedPnLCad, entryValueCad, exitValueCad,
    combinedCadReturnPct: entryValueCad > 0 ? ((exitValueCad - entryValueCad) / entryValueCad) * 100 : null,
    exits: perLeg,
  };
}
