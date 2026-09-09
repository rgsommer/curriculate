// backend/services/stocksExitForward.js
//
// P3 (2026-09-09) — exit-forward metrics.
//
//   1. `stampExitForwardOnClose({ row })` — seeds a StocksExitForwardMetric
//      row when a SELL/TRIM/EXIT closes a position. Called on-demand
//      by the attribution engine as it walks the ledger; also invokable
//      from trade-close hooks in the future.
//
//   2. `backfillExitForwardMetrics({ email, asOf })` — walks any
//      existing rows whose horizons have elapsed and fills them in
//      using historical bars. Idempotent — never re-overwrites a
//      FILLED horizon; a horizon in MISSING_DATA can be retried.
//
//   3. Classification (only after all horizons COMPLETE):
//        GOOD_EXIT       — day5Alpha ≥ +2% AND day20Alpha ≥ +1%
//        LATE_EXIT       — day1Alpha ≤ -2% AND day5Alpha ≤ -1%   (kept holding too long)
//        PREMATURE_EXIT  — day5Alpha ≥ +3% AND day20Alpha ≥ +3% AND day60Alpha ≥ +5%
//                          (security rallied strongly right after we sold)
//        NEUTRAL         — everything else

import StocksExitForwardMetric from "../models/StocksExitForwardMetric.js";
import { pickBenchmarkFor, getMatchedReturnPct } from "./stocksBenchmarkMatched.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const HORIZONS = [1, 5, 10, 20, 60];

// Given an exit event, seed the metric row with PENDING horizons.
export async function stampExitForwardOnClose({ email, row }) {
  if (!row || !row.exitDate || !row.exitPrice || !row.ticker) return null;
  const doc = {
    email: String(email || "").toLowerCase(),
    ticker: String(row.ticker).toUpperCase(),
    account: row.account || null,
    sleeve: row.sleeve || null,
    exitDate: row.exitDate,
    exitPrice: Number(row.exitPrice),
    currency: row.entryCurrency || row.currency || "USD",
    benchmarkTicker: pickBenchmarkFor({ ticker: row.ticker, currency: row.entryCurrency || row.currency }),
    exitTradeRef: row.exitTradeRef || null,
    exitAction: row.exitAction || "SELL",
    horizons: HORIZONS.map(h => ({ horizonDays: h, status: "PENDING" })),
    classification: "PENDING",
  };
  try {
    await StocksExitForwardMetric.updateOne(
      { email: doc.email, ticker: doc.ticker, exitDate: doc.exitDate, exitTradeRef: doc.exitTradeRef },
      { $setOnInsert: doc }, { upsert: true },
    );
  } catch (e) {
    console.warn(`[exit-forward] seed failed for ${row.ticker}:`, e?.message);
  }
  return doc;
}

// Walks existing PENDING horizons and fills any whose horizon has
// actually elapsed. Fire-and-forget from a daily cron.
export async function backfillExitForwardMetrics({ email, asOf = new Date() } = {}) {
  const q = email ? { email: String(email).toLowerCase() } : {};
  const rows = await StocksExitForwardMetric.find({
    ...q,
    "horizons.status": "PENDING",
    exitDate: { $lte: asOf },
  }).lean();
  let updatedRows = 0, filledHorizons = 0, missingHorizons = 0;
  for (const row of rows) {
    const bars = await fetchYahooDaily(row.ticker, "1y").catch(() => null);
    const benchBars = await fetchYahooDaily(row.benchmarkTicker, "1y").catch(() => null);
    const exitTs = new Date(row.exitDate).getTime();
    const nextHorizons = row.horizons.map(h => ({ ...h }));
    for (const h of nextHorizons) {
      if (h.status === "FILLED") continue;
      const horizonMs = h.horizonDays * 86400_000;
      if (exitTs + horizonMs > asOf.getTime()) continue; // not elapsed yet
      // Find the trading bar closest to (exitDate + horizonDays).
      const forwardDate = new Date(exitTs + horizonMs).toISOString().slice(0, 10);
      const bar = (bars || []).slice().reverse().find(b => (b.date || "").slice(0, 10) <= forwardDate);
      if (!bar || !(bar.close > 0) || !(row.exitPrice > 0)) {
        h.status = "MISSING_DATA"; missingHorizons++;
        continue;
      }
      const forwardReturnPct = ((bar.close - row.exitPrice) / row.exitPrice) * 100;
      // Matched-benchmark forward return.
      let benchmarkForwardReturnPct = null;
      if (benchBars) {
        const bres = await getMatchedReturnPct({
          ticker: row.benchmarkTicker,
          fromDate: row.exitDate,
          toDate: forwardDate,
          bars: benchBars,
        });
        benchmarkForwardReturnPct = bres.pct;
      }
      const exitAlphaPct = (Number.isFinite(forwardReturnPct) && Number.isFinite(benchmarkForwardReturnPct))
        ? forwardReturnPct - benchmarkForwardReturnPct : null;
      h.forwardPricePeriod = bar.close;
      h.forwardReturnPct = forwardReturnPct;
      h.benchmarkForwardReturnPct = benchmarkForwardReturnPct;
      h.exitAlphaPct = exitAlphaPct;
      h.filledAt = new Date();
      h.status = "FILLED";
      filledHorizons++;
    }
    // Classification only if ALL horizons are terminal (FILLED or MISSING_DATA).
    let classification = row.classification;
    let classifiedAt = row.classifiedAt;
    const allTerminal = nextHorizons.every(h => h.status !== "PENDING");
    if (allTerminal && classification === "PENDING") {
      classification = classifyExit(nextHorizons);
      classifiedAt = new Date();
    }
    try {
      await StocksExitForwardMetric.updateOne(
        { _id: row._id },
        { $set: { horizons: nextHorizons, classification, classifiedAt, lastBackfillAt: new Date() } },
      );
      updatedRows++;
    } catch (e) {
      console.warn(`[exit-forward] backfill persist warn for ${row.ticker}:`, e?.message);
    }
  }
  return { candidateRows: rows.length, updatedRows, filledHorizons, missingHorizons };
}

function alpha(hors, d) {
  const h = (hors || []).find(x => x.horizonDays === d);
  return h && h.status === "FILLED" ? h.exitAlphaPct : null;
}

export function classifyExit(hors) {
  const a1 = alpha(hors, 1), a5 = alpha(hors, 5), a20 = alpha(hors, 20), a60 = alpha(hors, 60);
  if (Number.isFinite(a5) && Number.isFinite(a20) && Number.isFinite(a60) &&
      a5 >= 3 && a20 >= 3 && a60 >= 5) return "PREMATURE_EXIT";
  if (Number.isFinite(a1) && Number.isFinite(a5) && a1 <= -2 && a5 <= -1) return "LATE_EXIT";
  if (Number.isFinite(a5) && Number.isFinite(a20) && a5 >= 2 && a20 >= 1) return "GOOD_EXIT";
  return "NEUTRAL";
}
