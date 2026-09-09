// backend/services/stocksEarningsSurprise.js
//
// P2.5 (2026-09-09) — earnings surprise + post-earnings drift.
//
// This module is intentionally not just "gap > 5% = positive". It
// separates two outcomes that historically diverge sharply:
//
//   POSITIVE_ACCEPTANCE — beat + constructive holding of the gap
//     (day-5 close still holds ≥50% of day-1 open gap; day-5 return
//     positive vs benchmark; healthy day-1 RVOL)
//
//   POSITIVE_FAILED     — beat + immediate gap failure
//     (gap gave more than half back by day 5, or day-5 return worse
//     than benchmark)
//
// The service:
//   1. Fetches FMP /earnings-surprises/{sym} — latest N reports.
//   2. For each report, fetches the FMP or Yahoo daily bars around
//      the earnings date to compute gap / day-1 / day-3 / day-5
//      returns + a benchmark-relative comparison.
//   3. Scores each report into a driftScore (0..100) with a
//      classification label.
//   4. Persists every scored report to StocksEarningsSurpriseCache
//      keyed by (ticker, earningsDate) so a later replay uses the
//      same numbers.
//   5. Returns the MOST RECENT scored report + a rolling per-ticker
//      driftScore that folds in the last two reports (weighted 70/30
//      most-recent:prior).
//
// Fail-open: any fetch failure → { ok: false, reason }. Missing bars
// after the report → we still persist the surprise numbers with
// driftClassification="INSUFFICIENT_DATA" so the row exists.

import { isFmpEnabled, fmpDisabledReason } from "./fmpEnabled.js";
import StocksEarningsSurpriseCache from "../models/StocksEarningsSurpriseCache.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const FMP_BASE = "https://financialmodelingprep.com";
const TIMEOUT_MS = Number(process.env.STOCKS_FMP_TIMEOUT_MS) || 8000;
function fmpKey() { return process.env.FMP_API_KEY || ""; }
async function fmpGet(path) {
  if (!fmpKey()) throw new Error("FMP_API_KEY not configured");
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(fmpKey())}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`fmp ${r.status}`);
    return await r.json();
  } finally { clearTimeout(tid); }
}

// Locate a bar N trading-day-index positions AFTER the earnings
// bar. `bars` is sorted oldest → newest (Yahoo daily). Returns null
// if the sequence doesn't extend that far.
function nthAfterEarnings(bars, earningsIdx, n) {
  if (!Array.isArray(bars) || earningsIdx < 0) return null;
  const idx = earningsIdx + n;
  return bars[idx] || null;
}
function findEarningsBarIdx(bars, earningsDateYmd) {
  if (!Array.isArray(bars) || !earningsDateYmd) return -1;
  // Take the LAST bar with date <= earningsDate (report can be after-hours;
  // day-0 is the closest trading day at/before the report).
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = String(bars[i]?.date || "").slice(0, 10);
    if (d && d <= earningsDateYmd) return i;
  }
  return -1;
}
function pct(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

// Evaluate one earnings report against the post-earnings price
// trajectory. Requires `bars` covering ≥5 trading days after the
// earningsDate. Returns { gapOpenPct, day1ClosePct, day3ClosePct,
// day5ClosePct, day1VsBenchPct, day5VsBenchPct, day1Rvol,
// gapHeldAtDay5, driftScore, driftClassification }.
function scoreDrift(report, bars, benchBars) {
  const eYmd = String(report.earningsDate || report.date || "").slice(0, 10);
  const idx = findEarningsBarIdx(bars, eYmd);
  if (idx < 0) return { driftClassification: "INSUFFICIENT_DATA" };
  const day0 = bars[idx];
  const day1 = nthAfterEarnings(bars, idx, 1);
  const day3 = nthAfterEarnings(bars, idx, 3);
  const day5 = nthAfterEarnings(bars, idx, 5);
  if (!day0 || !day1 || !day5) return { driftClassification: "INSUFFICIENT_DATA" };

  const gapOpenPct   = pct(day0.close, day1.open);
  const day1ClosePct = pct(day0.close, day1.close);
  const day3ClosePct = day3 ? pct(day0.close, day3.close) : null;
  const day5ClosePct = pct(day0.close, day5.close);

  // Benchmark alignment.
  let day1VsBenchPct = null, day5VsBenchPct = null;
  if (Array.isArray(benchBars) && benchBars.length > 0) {
    const bIdx = findEarningsBarIdx(benchBars, eYmd);
    const b0 = benchBars[bIdx], b1 = nthAfterEarnings(benchBars, bIdx, 1), b5 = nthAfterEarnings(benchBars, bIdx, 5);
    if (b0 && b1) day1VsBenchPct = (day1ClosePct ?? 0) - (pct(b0.close, b1.close) ?? 0);
    if (b0 && b5) day5VsBenchPct = (day5ClosePct ?? 0) - (pct(b0.close, b5.close) ?? 0);
  }

  // Day-1 RVOL — day1 volume vs 50-day avg leading in.
  let day1Rvol = null;
  const vols = bars.slice(Math.max(0, idx - 50), idx).map(b => b.volume).filter(v => Number.isFinite(v) && v > 0);
  if (vols.length >= 10 && Number.isFinite(day1.volume)) {
    const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
    day1Rvol = day1.volume / avg;
  }

  // Gap-held: at day 5 close, at least 50% of the day-1 open gap remains.
  let gapHeldAtDay5 = null;
  if (Number.isFinite(gapOpenPct) && Number.isFinite(day5ClosePct)) {
    if (gapOpenPct > 0) gapHeldAtDay5 = day5ClosePct >= gapOpenPct * 0.5;
    else if (gapOpenPct < 0) gapHeldAtDay5 = day5ClosePct <= gapOpenPct * 0.5;
    else gapHeldAtDay5 = day5ClosePct > 0;
  }

  // Score composition — magnitude of drift, gap retention, benchmark
  // relative, volume confirmation. All 0..100 additive with caps.
  let score = 50;
  if (Number.isFinite(day5ClosePct)) score += Math.max(-25, Math.min(25, day5ClosePct)); // ±25 pts for direct 5-day return
  if (Number.isFinite(day5VsBenchPct)) score += Math.max(-15, Math.min(15, day5VsBenchPct));
  if (gapHeldAtDay5 === true) score += 10;
  if (gapHeldAtDay5 === false) score -= 15;
  if (Number.isFinite(day1Rvol) && day1Rvol >= 1.5) score += 5;
  if (Number.isFinite(day1Rvol) && day1Rvol < 0.8) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Classification
  const epsSurp = Number(report.epsSurprisePct);
  let cls = "NEUTRAL";
  if (Number.isFinite(epsSurp) && epsSurp > 0) {
    cls = gapHeldAtDay5 === true && (day5VsBenchPct == null || day5VsBenchPct >= 0)
      ? "POSITIVE_ACCEPTANCE"
      : gapHeldAtDay5 === false || (Number.isFinite(day5VsBenchPct) && day5VsBenchPct < -2)
        ? "POSITIVE_FAILED"
        : "POSITIVE_MIXED";
  } else if (Number.isFinite(epsSurp) && epsSurp < 0) {
    cls = "NEGATIVE";
  }
  return { gapOpenPct, day1ClosePct, day3ClosePct, day5ClosePct,
           day1VsBenchPct, day5VsBenchPct, day1Rvol, gapHeldAtDay5,
           postEarningsDriftScore: score, driftClassification: cls };
}

// Fold two reports into a rolling ticker-level drift score. 70/30 blend,
// most-recent weighted higher. If only one is present, use it directly.
function rollScore(recent, prior) {
  const a = Number(recent?.postEarningsDriftScore);
  const b = Number(prior?.postEarningsDriftScore);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.round(a * 0.7 + b * 0.3);
  if (Number.isFinite(a)) return Math.round(a);
  if (Number.isFinite(b)) return Math.round(b);
  return null;
}

// PUBLIC — evaluate ticker's most-recent-earnings drift.
export async function getEarningsSurpriseAndDrift(ticker, { benchmarkTicker = "SPY" } = {}) {
  if (!isFmpEnabled()) return { ok: false, reason: fmpDisabledReason() || "fmp_disabled" };
  try {
    const surprises = await fmpGet(`/api/v3/earnings-surprises/${encodeURIComponent(ticker)}`).catch(() => null);
    if (!Array.isArray(surprises) || surprises.length === 0) {
      return { ok: false, reason: "no earnings-surprise data" };
    }
    const sorted = [...surprises].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const top = sorted.slice(0, 3).map(row => ({
      earningsDate: String(row.date || "").slice(0, 10),
      reportedEPS: Number.isFinite(row.actualEarningResult) ? row.actualEarningResult : (Number.isFinite(row.actualEarnings) ? row.actualEarnings : null),
      estimatedEPS: Number.isFinite(row.estimatedEarning) ? row.estimatedEarning : (Number.isFinite(row.estimatedEarnings) ? row.estimatedEarnings : null),
      epsSurprisePct: (() => {
        const a = row.actualEarningResult ?? row.actualEarnings;
        const e = row.estimatedEarning ?? row.estimatedEarnings;
        if (!Number.isFinite(a) || !Number.isFinite(e) || e === 0) return null;
        return ((a - e) / Math.abs(e)) * 100;
      })(),
      rawSurprise: row,
    }));
    // Fetch bars once (up to 1y so all 3 reports fit).
    const [bars, benchBars] = await Promise.all([
      fetchYahooDaily(ticker, "1y").catch(() => null),
      fetchYahooDaily(benchmarkTicker, "1y").catch(() => null),
    ]);
    const evaluated = [];
    for (const r of top) {
      const drift = scoreDrift(r, bars, benchBars);
      const merged = { ...r, ...drift };
      evaluated.push(merged);
      // Persist per-report row (idempotent upsert).
      try {
        await StocksEarningsSurpriseCache.updateOne(
          { ticker, earningsDate: r.earningsDate },
          { $set: {
            ticker, earningsDate: r.earningsDate,
            reportedEPS: r.reportedEPS, estimatedEPS: r.estimatedEPS,
            epsSurprisePct: r.epsSurprisePct,
            reportedRevenue: Number.isFinite(r.rawSurprise?.actualRevenue) ? r.rawSurprise.actualRevenue : null,
            estimatedRevenue: Number.isFinite(r.rawSurprise?.estimatedRevenue) ? r.rawSurprise.estimatedRevenue : null,
            revenueSurprisePct: (() => {
              const a = r.rawSurprise?.actualRevenue, e = r.rawSurprise?.estimatedRevenue;
              if (!Number.isFinite(a) || !Number.isFinite(e) || e === 0) return null;
              return ((a - e) / Math.abs(e)) * 100;
            })(),
            gapOpenPct: drift.gapOpenPct ?? null,
            day1ClosePct: drift.day1ClosePct ?? null,
            day3ClosePct: drift.day3ClosePct ?? null,
            day5ClosePct: drift.day5ClosePct ?? null,
            day1VsBenchPct: drift.day1VsBenchPct ?? null,
            day5VsBenchPct: drift.day5VsBenchPct ?? null,
            day1Rvol: drift.day1Rvol ?? null,
            gapHeldAtDay5: drift.gapHeldAtDay5 ?? null,
            postEarningsDriftScore: drift.postEarningsDriftScore ?? null,
            driftClassification: drift.driftClassification || "INSUFFICIENT_DATA",
            rawSurprise: r.rawSurprise,
            fetchedAt: new Date(),
          }},
          { upsert: true },
        );
      } catch { /* soft-fail */ }
    }
    const recent = evaluated[0] || null;
    const prior = evaluated[1] || null;
    return {
      ok: true, ticker, dataAsOf: new Date(),
      recent, prior,
      rollingDriftScore: rollScore(recent, prior),
      reportCount: evaluated.length,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || "fetch failed" };
  }
}

// Normalize to 0..1 for the OQ scorer.
export function driftToSubScore(res) {
  if (!res || !res.ok) return null;
  const s = res.rollingDriftScore;
  return Number.isFinite(s) ? s / 100 : null;
}
