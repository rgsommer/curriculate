// backend/services/stocksPositionStopMonitor.js
//
// P&L-based stop monitor. Reads every held position, compares current
// price against cost basis in the SAME currency, computes signed P&L%,
// and buckets positions into risk tiers so the daily briefing can force
// the AI to surface any approaching-stop situation before it becomes a
// -20% DJT-style disaster.
//
// The trader's own journal analysis (Trade Journal AI Pattern Learning)
// concluded that a hard -8% stop on non-core positions would have saved
// $1,800+ on the DJT trades. This service enforces that rule as a daily
// check — the user doesn't have to remember to look.
//
// Tiers (based on signed pnlPct):
//   pnlPct ≤ -8%:            "hard-stop-hit"   🚨  EXIT AT MARKET
//   -8% < pnlPct ≤ -6%:      "within-stop"     ⚠️  WITHIN 2% — tighten
//   -6% < pnlPct ≤ -5%:      "watch"           👀  3% from stop
//   otherwise:                (not flagged — normal position)
//
// Core-ticker exemption: RY and ENB (per the journal analysis's
// "your only consistent winners" finding). Configurable per user in a
// future iteration; hard-coded for now.

const CORE_EXEMPT_TICKERS = new Set(["RY", "ENB", "RY.TO", "ENB.TO"]);
const HARD_STOP_PCT = -8;
const WITHIN_STOP_PCT = -6;
const WATCH_PCT = -5;

function computePositionPnl(position) {
  const ccy = position.ccy || "USD";
  const priceKey = ccy === "USD" ? "priceUsd" : "priceCad";
  const basisKey = ccy === "USD" ? "costBasisUsd" : "costBasisCad";
  const price = position[priceKey];
  const basis = position[basisKey];
  if (!Number.isFinite(price) || !Number.isFinite(basis) || !(basis > 0)) return null;
  return ((price - basis) / basis) * 100;
}

export function monitorPositionStops(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { hardStopHit: [], withinStop: [], watch: [] };
  }
  const hardStopHit = [];
  const withinStop = [];
  const watch = [];

  // Aggregate P&L per (ticker + currency + account) so partial fills at
  // different cost bases don't confuse the flag. Position rows are one per
  // acct+ticker+ccy already, so this is one bucket per row.
  for (const p of positions) {
    const pnlPct = computePositionPnl(p);
    if (pnlPct == null) continue;
    if (pnlPct > WATCH_PCT) continue; // above -5%, not flagged

    const tickerCore = String(p.ticker || "").toUpperCase();
    const isCoreExempt = CORE_EXEMPT_TICKERS.has(tickerCore);
    // Core exemption ONLY applies to the "watch" tier; a -8% hit is still
    // a hit even on RY/ENB (though it would be extreme for a blue chip).
    if (isCoreExempt && pnlPct > HARD_STOP_PCT) continue;

    const row = {
      ticker: p.ticker,
      account: p.acct,
      currency: p.ccy,
      qty: p.qty,
      currentPrice: p.ccy === "USD" ? p.priceUsd : p.priceCad,
      costBasis: p.ccy === "USD" ? p.costBasisUsd : p.costBasisCad,
      pnlPct,
      distanceToHardStopPct: pnlPct - HARD_STOP_PCT, // positive = above stop; negative = below
      isCoreExempt,
    };

    if (pnlPct <= HARD_STOP_PCT) hardStopHit.push(row);
    else if (pnlPct <= WITHIN_STOP_PCT) withinStop.push(row);
    else watch.push(row);
  }

  hardStopHit.sort((a, b) => a.pnlPct - b.pnlPct);
  withinStop.sort((a, b) => a.pnlPct - b.pnlPct);
  watch.sort((a, b) => a.pnlPct - b.pnlPct);
  return { hardStopHit, withinStop, watch };
}

export function formatPositionStopBlock(monitor) {
  if (!monitor) return "";
  const { hardStopHit, withinStop, watch } = monitor;
  if (hardStopHit.length === 0 && withinStop.length === 0 && watch.length === 0) return "";
  const lines = [`\nPOSITION P&L STOP MONITOR (-8% hard-stop rule from journal analysis):`];
  if (hardStopHit.length > 0) {
    lines.push(`  🚨 HARD STOP TRIGGERED (pnl ≤ -8%) — EXIT AT MARKET unless there is a specific new-info reason to override. When you reformat this block for the email, ONLY the ticker string at the START of each line below is a ticker; every word in this header is prose:`);
    for (const r of hardStopHit) {
      lines.push(`     ${r.ticker} in ${r.account}: ${r.qty} sh @ basis $${r.costBasis?.toFixed(2)} ${r.currency}, now $${r.currentPrice?.toFixed(2)} = ${r.pnlPct.toFixed(1)}%${r.isCoreExempt ? " (CORE ticker — unusual, verify basis)" : ""}`);
    }
  }
  if (withinStop.length > 0) {
    lines.push(`  ⚠ WITHIN 2% OF STOP (pnl -8% to -6%) — tighten stop to break-even OR trim now:`);
    for (const r of withinStop) {
      lines.push(`     ${r.ticker} in ${r.account}: ${r.qty} sh @ basis $${r.costBasis?.toFixed(2)} ${r.currency}, now $${r.currentPrice?.toFixed(2)} = ${r.pnlPct.toFixed(1)}% · ${(HARD_STOP_PCT - r.pnlPct).toFixed(1)}% cushion left`);
    }
  }
  if (watch.length > 0) {
    lines.push(`  👀 WATCH (pnl -6% to -5%) — 3% from hard stop, keep on radar:`);
    for (const r of watch) {
      lines.push(`     ${r.ticker} in ${r.account}: ${r.qty} sh @ basis $${r.costBasis?.toFixed(2)} ${r.currency}, now $${r.currentPrice?.toFixed(2)} = ${r.pnlPct.toFixed(1)}%`);
    }
  }
  return lines.join("\n");
}
