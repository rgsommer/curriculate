// backend/services/stocksQualityCompounder.js
//
// Quality-Compounder archetype detector (Tier 3.1 audit Aug-28).
// The audit identified that the system had no scoring for the durable
// quality-compounder pattern — high ROIC/ROE, low leverage, high FCF
// conversion, low share dilution. These are the Brookfield / CSU /
// Constellation-class names that historically generate the best
// long-hold returns.
//
// This module computes a 0-1 quality score from TTM fundamentals +
// growth data:
//   • ROE ≥ 15% (high return on capital)
//   • FCF yield > 3% (converts profits to cash)
//   • Debt/Equity < 1.0 (conservative balance sheet)
//   • Margin durability (opMargin trend flat-to-improving over Q0 vs Q4)
//   • Revenue growth positive (not shrinking)
//
// Full "5-year ROIC consistency" (the audit's aspirational target)
// would require multi-year data we don't currently fetch — that's a
// Phase B enhancement. This MVP uses the TTM + Q0/Q4 data already in
// the multi-factor composite as a proxy for durability. Better than
// nothing; upgradeable when we wire Sharadar or similar.
//
// A qualifying compounder gets a +5 bump to compositeRank (same
// magnitude as news catalyst) — small enough that it doesn't
// override the composite, big enough to help a genuine compounder
// outrank a mediocre trader.

export function detectQualityCompounder({ fundamentals, growth }) {
  if (!fundamentals?.ok || !growth?.ok) {
    return { isCompounder: false, score: 0, reasons: ["insufficient data"] };
  }
  const reasons = [];
  let checkPassed = 0;
  const totalChecks = 5;

  // Check 1: high ROE (durable return on shareholder capital)
  if (Number.isFinite(fundamentals.roe) && fundamentals.roe >= 15) {
    checkPassed++;
    reasons.push(`ROE ${fundamentals.roe.toFixed(1)}% ≥ 15`);
  }

  // Check 2: solid FCF yield (converts earnings to cash)
  if (Number.isFinite(fundamentals.freeCashFlowYieldPct) && fundamentals.freeCashFlowYieldPct > 3) {
    checkPassed++;
    reasons.push(`FCF yield ${fundamentals.freeCashFlowYieldPct.toFixed(1)}% > 3`);
  }

  // Check 3: conservative leverage
  if (Number.isFinite(fundamentals.dToE) && fundamentals.dToE < 1.0) {
    checkPassed++;
    reasons.push(`D/E ${fundamentals.dToE.toFixed(2)} < 1.0`);
  }

  // Check 4: margin durability — op margin flat-to-improving vs same
  // quarter a year ago. A true compounder holds pricing power; the
  // audit specifically called out "margin durability variance" as the
  // signal we lack. Proxy: opMarginExpansionPp ≥ 0 (no compression).
  if (Number.isFinite(growth.opMarginExpansionPp) && growth.opMarginExpansionPp >= 0) {
    checkPassed++;
    reasons.push(`op margin durability ${growth.opMarginExpansionPp >= 0 ? "+" : ""}${growth.opMarginExpansionPp.toFixed(1)}pp`);
  }

  // Check 5: revenue growth positive (not a stagnating cash cow)
  if (Number.isFinite(growth.revenueYoYPct) && growth.revenueYoYPct > 3) {
    checkPassed++;
    reasons.push(`revenue growth +${growth.revenueYoYPct.toFixed(1)}%`);
  }

  const score = checkPassed / totalChecks;
  const isCompounder = checkPassed >= 4; // 4 of 5 checks pass
  return {
    isCompounder,
    score,
    checksPassed: checkPassed,
    totalChecks,
    reasons,
  };
}

// Applied bonus for a qualifying compounder — same magnitude as news
// catalyst so multiple archetype signals stack multiplicatively.
export const QUALITY_COMPOUNDER_BUMP = 5;

// Convenience: given a pick with `.fundamentals` and `.growth` shape
// (as populated by pick engine stage 2), return { bumped: bool,
// bumpAmount, badge, reasons }.
export function evaluateCompounderForPick({ fundamentals, growth }) {
  const detection = detectQualityCompounder({ fundamentals, growth });
  if (!detection.isCompounder) return { bumped: false, bumpAmount: 0, badge: null, reasons: detection.reasons };
  return {
    bumped: true,
    bumpAmount: QUALITY_COMPOUNDER_BUMP,
    badge: `Quality Compounder (${detection.checksPassed}/${detection.totalChecks})`,
    reasons: detection.reasons,
    detection,
  };
}
