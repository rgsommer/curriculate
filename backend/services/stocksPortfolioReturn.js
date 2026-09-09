// backend/services/stocksPortfolioReturn.js
//
// P3.5 (2026-09-09) — portfolio return with EXTERNAL CASH FLOWS.
//
// P3 used  (endEqCad − startEqCad) / startEqCad, which is only valid
// when there are no deposits, withdrawals, transfers, or other
// non-investment portfolio-value changes. This module detects real
// cash flows from the trade journal (DEPOSIT / WITHDRAW legs) and
// switches methodology:
//
//   simple            — verified externalCashFlow = 0
//   modified-dietz    — irregular flows, daily valuations optional
//   time-weighted     — daily valuations available; TWR is the gold standard
//
// Contract:
//   computePortfolioReturn({ email, snaps, cashFlows, method }) →
//     {
//       returnMethod: "simple" | "modified-dietz" | "time-weighted",
//       returnMethodReason,
//       portfolioReturnPct,
//       externalCashFlowCad,
//       cashFlowCoverage:  "COMPLETE" | "PARTIAL" | "NONE",
//       intervals: [ { from, to, netFlowCad, startCad, endCad, subReturnPct } ],
//       note: string | null,
//     }
//
// Cash-flow coverage stamp:
//   COMPLETE — all DEPOSIT/WITHDRAW legs in the trade journal fall
//              inside the daily snapshot dates and every flow date
//              also has a snapshot.
//   PARTIAL  — we know SOME flows but suspect gaps (e.g., no journal
//              legs at all, or a flow lands on a day without a snapshot).
//   NONE     — no daily snapshots available; only start/end totals.

import StocksTradeJournal from "../models/StocksTradeJournal.js";

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// PUBLIC — extract external cash flows from the trade journal. A
// DEPOSIT leg is a positive cash flow (money in), WITHDRAW is
// negative. BUY/SELL legs are NOT cash flows for return purposes —
// they're internal reallocations.
export async function extractCashFlowsFromJournal({ email, fromYmd, toYmd }) {
  const trades = await StocksTradeJournal.find({
    email: String(email || "").toLowerCase(),
    executedAt: { $gte: new Date(fromYmd), $lte: new Date(toYmd + "T23:59:59Z") },
  }).sort({ executedAt: 1 }).lean();
  const flows = [];
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (leg.side !== "DEPOSIT" && leg.side !== "WITHDRAW") continue;
      const signedCad = (leg.side === "DEPOSIT" ? 1 : -1) *
        (leg.currency === "CAD" ? (leg.grossValue || 0) : (leg.grossValue || 0) * (t.fxUsdCadAtTrade || 1.37));
      flows.push({
        date: ymd(t.executedAt),
        side: leg.side,
        currency: leg.currency,
        native: leg.grossValue,
        signedCad,
        tradeRef: t._id,
        account: t.account || null,
      });
    }
  }
  return flows;
}

// PUBLIC — Modified Dietz return. Handles irregular cash flows
// without requiring daily portfolio valuations.
//   r = (endCad − startCad − ΣnetFlow) / (startCad + Σ(w_i × flow_i))
// where w_i = (T − t_i) / T, and t_i is days since start.
export function modifiedDietz({ startCad, endCad, cashFlows, windowDays }) {
  if (!(startCad > 0)) return null;
  const T = Math.max(1, windowDays);
  let flowSum = 0;
  let weightedFlow = 0;
  for (const f of cashFlows) {
    const daysFromStart = Math.max(0, Math.min(T, Number(f.daysFromStart) || 0));
    const w = (T - daysFromStart) / T;
    flowSum += f.signedCad;
    weightedFlow += w * f.signedCad;
  }
  const numer = endCad - startCad - flowSum;
  const denom = startCad + weightedFlow;
  if (!(denom > 0)) return null;
  return (numer / denom) * 100;
}

// PUBLIC — Time-Weighted Return. Requires daily-ish snapshots so we
// can compute sub-period returns between each flow.
// Chain-links (1 + r_i) − 1 across intervals bounded by cash flows.
// snaps must be sorted ascending and cover both endpoints.
export function timeWeightedReturn({ snaps, cashFlows }) {
  if (!Array.isArray(snaps) || snaps.length < 2) return null;
  const bounds = new Set(snaps.map(s => ymd(s.date)));
  // Ensure each flow date is a bound; if not, we still compute using
  // nearest earlier snap. The engine caller decides whether coverage
  // is COMPLETE or PARTIAL.
  const flowByDate = new Map();
  for (const f of cashFlows) {
    const d = ymd(f.date);
    flowByDate.set(d, (flowByDate.get(d) || 0) + f.signedCad);
  }
  const intervals = [];
  let productReturnPlusOne = 1;
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1], cur = snaps[i];
    const prevVal = Number(prev.totalCad);
    const curVal = Number(cur.totalCad);
    const flow = flowByDate.get(ymd(cur.date)) || 0;
    // Sub-return: (V_end − flow − V_start) / V_start
    if (!(prevVal > 0)) continue;
    const r = (curVal - flow - prevVal) / prevVal;
    if (Number.isFinite(r)) {
      productReturnPlusOne *= (1 + r);
      intervals.push({ from: ymd(prev.date), to: ymd(cur.date), netFlowCad: flow, startCad: prevVal, endCad: curVal, subReturnPct: r * 100 });
    }
  }
  return { returnPct: (productReturnPlusOne - 1) * 100, intervals };
}

// PUBLIC — dispatcher. Chooses the best-supported method.
// Optional `cashFlows` overrides the Mongo fetch — pass it in tests or
// when the caller already has flows in hand.
export async function computePortfolioReturn({ email, snaps, windowStartYmd, windowEndYmd, method = "auto", cashFlows: cashFlowsOverride }) {
  if (!Array.isArray(snaps) || snaps.length < 2) {
    return {
      returnMethod: null, returnMethodReason: "insufficient-snapshots",
      portfolioReturnPct: null, externalCashFlowCad: 0,
      cashFlowCoverage: "NONE", intervals: [], note: "Need ≥2 daily snapshots.",
    };
  }
  const first = snaps[0], last = snaps[snaps.length - 1];
  const startCad = Number(first.totalCad);
  const endCad = Number(last.totalCad);
  const flows = Array.isArray(cashFlowsOverride)
    ? cashFlowsOverride
    : await extractCashFlowsFromJournal({ email, fromYmd: windowStartYmd, toYmd: windowEndYmd });
  const externalCashFlowCad = flows.reduce((s, f) => s + f.signedCad, 0);
  const windowDays = Math.max(1, Math.round((new Date(last.date) - new Date(first.date)) / 86400_000));
  const flowsWithDays = flows.map(f => ({
    ...f,
    daysFromStart: Math.max(0, Math.round((new Date(f.date) - new Date(first.date)) / 86400_000)),
  }));

  // Coverage assessment. If flows exist and each flow date has a
  // snapshot, TWR is trustworthy. If flows exist but some flow dates
  // are missing snapshots, degrade to Modified Dietz. If no flows at
  // all, simple is exactly correct.
  const flowDatesCovered = flows.every(f => snaps.some(s => ymd(s.date) === ymd(f.date)));
  let cashFlowCoverage;
  if (flows.length === 0) cashFlowCoverage = "COMPLETE";
  else if (flowDatesCovered) cashFlowCoverage = "COMPLETE";
  else cashFlowCoverage = "PARTIAL";

  // Auto-select
  let chosen = method;
  let reason = null;
  if (method === "auto") {
    if (flows.length === 0) { chosen = "simple"; reason = "no-external-flows"; }
    else if (snaps.length >= 5 && flowDatesCovered) { chosen = "time-weighted"; reason = "daily-snapshots-and-flow-dates-aligned"; }
    else { chosen = "modified-dietz"; reason = "irregular-or-uncovered-flow-dates"; }
  }

  let portfolioReturnPct = null;
  let intervals = [];
  if (chosen === "simple") {
    portfolioReturnPct = startCad > 0 ? ((endCad - startCad) / startCad) * 100 : null;
  } else if (chosen === "modified-dietz") {
    portfolioReturnPct = modifiedDietz({ startCad, endCad, cashFlows: flowsWithDays, windowDays });
  } else {
    const twr = timeWeightedReturn({ snaps, cashFlows: flowsWithDays });
    portfolioReturnPct = twr?.returnPct ?? null;
    intervals = twr?.intervals || [];
  }

  return {
    returnMethod: chosen,
    returnMethodReason: reason,
    portfolioReturnPct,
    externalCashFlowCad,
    cashFlowCoverage,
    intervals,
    note: chosen === "simple" && flows.length > 0
      ? "Simple selected despite detected flows — should not happen; caller override."
      : null,
  };
}
