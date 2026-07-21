// backend/services/stocksTwrr.js
//
// Time-weighted rate of return (TWRR). The correct answer to the
// question "how am I actually doing on my TRADING?" as opposed to the
// naive "portfolio value % change" which is contaminated by deposits
// and withdrawals.
//
// Algorithm:
//   1. Load the daily portfolio snapshots in [startDate, endDate].
//   2. Load every DEPOSIT/WITHDRAW leg in the trade journal in the same
//      window (external cash flows).
//   3. For each sub-period between snapshots, compute:
//         subReturn = (endValue - startValue - netExternalFlow) / startValue
//      Deposits shrink the return (subtracted), withdrawals grow it (added
//      back). Flows dated on day D are treated as arriving at the end of
//      day D-1 for the purpose of the D-1→D sub-period start value.
//   4. Compound geometrically:
//         twrr = ((1+r1)(1+r2)...(1+rN)) - 1
//
// Silently returns null when the snapshot series is too thin (<2 rows).
// Callers should treat null the same as "not enough history yet."

import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";

// Sum DEPOSIT/WITHDRAW legs into a per-day (YYYY-MM-DD) CAD map.
// Deposits are positive, withdrawals negative. USD legs convert at
// each trade's own fxUsdCadAtTrade (already stored on the parent doc).
async function externalFlowsByDay(email, startDate, endDate) {
  const trades = await StocksTradeJournal.find({
    email,
    executedAt: { $gte: startDate, $lte: endDate },
    "legs.side": { $in: ["DEPOSIT", "WITHDRAW"] },
  }).lean();
  const byDay = new Map();
  for (const t of trades) {
    const fx = t.fxUsdCadAtTrade || 1.37;
    const ymd = new Date(t.executedAt).toISOString().slice(0, 10);
    for (const leg of t.legs || []) {
      if (leg.side !== "DEPOSIT" && leg.side !== "WITHDRAW") continue;
      const cad = leg.currency === "USD"
        ? (leg.grossValue || 0) * fx
        : (leg.grossValue || 0);
      const signed = leg.side === "DEPOSIT" ? cad : -cad;
      byDay.set(ymd, (byDay.get(ymd) || 0) + signed);
    }
  }
  return byDay;
}

// Compute TWRR over [startDate, endDate]. Returns { twrrPct, subReturns,
// snapshotCount, netExternalFlowCad } or null on thin data.
export async function computeTwrr(email, startDate, endDate) {
  if (!email) return null;
  const snaps = await StocksPortfolioSnapshot.find({
    email,
    accountId: "__total__",
    date: {
      $gte: startDate.toISOString().slice(0, 10),
      $lte: endDate.toISOString().slice(0, 10),
    },
  }).sort({ date: 1 }).lean();
  if (snaps.length < 2) return null;

  const flows = await externalFlowsByDay(email, startDate, endDate);

  const subReturns = [];
  let netExternalFlow = 0;
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const curr = snaps[i];
    // Attribute a flow to the sub-period whose END day matches the
    // flow's date (i.e. the cash arrived some time during that day).
    const flowThisSub = flows.get(curr.date) || 0;
    netExternalFlow += flowThisSub;
    if (prev.totalCad <= 0) continue;
    // Standard TWRR sub-period formula. Contribution is subtracted from
    // the numerator so a deposit that increases end value doesn't get
    // counted as investment return.
    const r = (curr.totalCad - prev.totalCad - flowThisSub) / prev.totalCad;
    subReturns.push({ from: prev.date, to: curr.date, r, flow: flowThisSub });
  }

  if (subReturns.length === 0) return null;
  const compound = subReturns.reduce((acc, x) => acc * (1 + x.r), 1);
  const twrrPct = (compound - 1) * 100;
  return {
    twrrPct,
    subReturns,
    snapshotCount: snaps.length,
    netExternalFlowCad: netExternalFlow,
    startValue: snaps[0].totalCad,
    endValue: snaps[snaps.length - 1].totalCad,
    startDate: snaps[0].date,
    endDate: snaps[snaps.length - 1].date,
  };
}

// Annualize a TWRR observed over N calendar days.
export function annualizeTwrr(twrrPct, days) {
  if (!Number.isFinite(twrrPct) || !Number.isFinite(days) || days <= 0) return null;
  return (Math.pow(1 + twrrPct / 100, 365 / days) - 1) * 100;
}
