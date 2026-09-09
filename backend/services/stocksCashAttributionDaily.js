// backend/services/stocksCashAttributionDaily.js
//
// P3.5 (2026-09-09) — daily-interval cash attribution.
//
// P3 computed  -avgCashShare × (full-period passive return),  which
// hides the fact that cash HELPS on down days and HURTS on up days.
// If cash sat at 20% for 60 flat days then dropped to 5% for 30 up
// days, the average share × total return under-attributes the drag.
//
// New method:
//   For each snapshot-to-snapshot interval t→t+1:
//     cashWeight_t = cash_t / total_t          (share of portfolio)
//     benchReturn_t = passive_return_t         (matched interval)
//     dailyCashContribPp_t = -cashWeight_t × benchReturn_t
//   Chain-link cumulatively:
//     cumulativeCashDragPp = (Π (1 + drag_t/100)) - 1  in pp
//
// Fallback: if snapshot density < 5 rows over the window, mark
// LOW_COVERAGE and return the crude estimate with a note. Do NOT
// fabricate precision.

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// PUBLIC — compute cash attribution across snapshots vs a passive benchmark.
export async function computeDailyCashAttribution({ snaps, benchmarkTicker = "XEQT.TO" }) {
  if (!Array.isArray(snaps) || snaps.length < 2) {
    return {
      cumulativeCashDragPp: null,
      dailyIntervals: [], coverage: "NONE",
      note: "insufficient-snapshots",
    };
  }
  const first = snaps[0], last = snaps[snaps.length - 1];
  const bars = await fetchYahooDaily(benchmarkTicker, "1y").catch(() => null);
  const barByYmd = new Map((bars || []).map(b => [(b.date || "").slice(0, 10), Number(b.close)]));

  if (!barByYmd.size) {
    return {
      cumulativeCashDragPp: null,
      dailyIntervals: [], coverage: "NONE",
      note: "bench-bars-unavailable",
    };
  }
  const intervals = [];
  let product = 1;
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1], cur = snaps[i];
    const prevTotal = Number(prev.totalCad);
    if (!(prevTotal > 0)) continue;
    const prevCashCad = Number(prev.cashCad || 0) + Number(prev.cashUsd || 0) * Number(prev.fxUsdCad || 1.37);
    const cashWeight = prevCashCad / prevTotal;
    const prevClose = barByYmd.get(ymd(prev.date));
    const curClose = barByYmd.get(ymd(cur.date));
    if (!(prevClose > 0) || !(curClose > 0)) continue;
    const benchReturn = (curClose - prevClose) / prevClose;
    const dailyDrag = -cashWeight * benchReturn;
    product *= (1 + dailyDrag);
    intervals.push({
      from: ymd(prev.date), to: ymd(cur.date),
      cashWeight, benchReturnPct: benchReturn * 100,
      dailyCashContribPp: dailyDrag * 100,
    });
  }
  if (intervals.length === 0) {
    return {
      cumulativeCashDragPp: null,
      dailyIntervals: [], coverage: "NONE",
      note: "no-overlapping-bars",
    };
  }
  const coverage = intervals.length >= Math.min(5, snaps.length - 1) ? "COMPLETE"
                : intervals.length >= 3 ? "PARTIAL" : "LOW_COVERAGE";
  return {
    cumulativeCashDragPp: (product - 1) * 100,
    benchmarkTicker,
    dailyIntervals: intervals,
    coverage,
    note: coverage === "LOW_COVERAGE" ? "Fewer than 3 snapshot intervals; treat with caution." : null,
  };
}
