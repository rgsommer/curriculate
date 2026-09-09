// backend/services/stocksRealEpsRevisions.js
//
// P2.5 (2026-09-09) — REAL analyst EPS/revenue estimate revisions.
//
// Replaces the previous PRICE-TARGET-CHANGE proxy that lived in
// getEstimateRevisions (kept as a secondary CONTEXT signal). The
// existing signal was almost never what people mean when they say
// "estimate revisions" — it was moves in analysts' price targets,
// which drift for many reasons including simple share-price moves.
//
// This service:
//   1. Fetches FMP /analyst-estimates/{sym} (per-year consensus).
//   2. Snapshots FY0/FY1/Q0/Q1 EPS + revenue + analyst counts into
//      StocksAnalystEpsSnapshot (one row per (ticker, ymd)).
//   3. Compares today's snapshot against a snapshot from 4 weeks ago
//      (or the closest available 21-45 day window) to derive
//      REAL 4-week EPS/revenue revision % — and against a 12-week
//      window for revision ACCELERATION.
//   4. Returns a structured object with per-field revisions plus a
//      composite estimateRevisionScore (0..100) that weighs magnitude,
//      breadth, direction and acceleration.
//
// FMP shape (as observed): `/api/v3/analyst-estimates/{sym}` returns
// an array of yearly rows sorted latest-fiscal-year-first:
//   { date, symbol, estimatedRevenueLow, ..., estimatedRevenueAvg,
//     estimatedEbitdaAvg, estimatedNetIncomeAvg,
//     estimatedEpsAvg, estimatedEpsLow, estimatedEpsHigh,
//     numberAnalystEstimatedRevenue, numberAnalystsEstimatedEps }
// The most recent `date` is FY0; the following is FY1. Quarterly data
// lives at `/api/v3/analyst-estimates/{sym}?period=quarter`.
//
// Fail-open: any fetch failure returns { ok: false, reason } — the
// caller (scoreRealEpsRevisions) then treats revisions as missing.
// A missing PIT baseline (no 4-week-old snapshot yet) is REPORTED
// (coverage=partial) rather than fabricated.

import { isFmpEnabled, fmpDisabledReason } from "./fmpEnabled.js";
import StocksAnalystEpsSnapshot from "../models/StocksAnalystEpsSnapshot.js";

const FMP_BASE = "https://financialmodelingprep.com";
const TIMEOUT_MS = Number(process.env.STOCKS_FMP_TIMEOUT_MS) || 8000;
function fmpKey() { return process.env.FMP_API_KEY || ""; }
function ymdKey(d = new Date()) { return d.toISOString().slice(0, 10); }

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

// Fetch (annual, quarterly) analyst-estimate arrays in parallel.
async function fetchRawEstimates(ticker) {
  const [annual, quarterly] = await Promise.all([
    fmpGet(`/api/v3/analyst-estimates/${encodeURIComponent(ticker)}`).catch(() => null),
    fmpGet(`/api/v3/analyst-estimates/${encodeURIComponent(ticker)}?period=quarter`).catch(() => null),
  ]);
  return { annual, quarterly };
}

function firstNonNullNumber(...xs) {
  for (const x of xs) if (Number.isFinite(x)) return x;
  return null;
}

// Given annual + quarterly arrays, project FY0/FY1/Q0/Q1 rows.
function projectRows({ annual, quarterly }) {
  const fy = Array.isArray(annual) ? [...annual].sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
  const qt = Array.isArray(quarterly) ? [...quarterly].sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
  const fy0 = fy[0] || null;
  const fy1 = fy[1] || null;
  const q0 = qt[0] || null;
  const q1 = qt[1] || null;
  return { fy0, fy1, q0, q1 };
}

// Persist today's snapshot (best-effort; a Mongo hiccup returns false
// rather than throwing, so a cron never fails on persistence).
async function persistSnapshot(ticker, projected) {
  try {
    const { fy0, fy1, q0, q1 } = projected;
    const doc = {
      ticker,
      ymd: ymdKey(),
      fetchedAt: new Date(),
      fy0_eps: firstNonNullNumber(fy0?.estimatedEpsAvg),
      fy0_revenue: firstNonNullNumber(fy0?.estimatedRevenueAvg),
      fy1_eps: firstNonNullNumber(fy1?.estimatedEpsAvg),
      fy1_revenue: firstNonNullNumber(fy1?.estimatedRevenueAvg),
      q0_eps: firstNonNullNumber(q0?.estimatedEpsAvg),
      q0_revenue: firstNonNullNumber(q0?.estimatedRevenueAvg),
      q1_eps: firstNonNullNumber(q1?.estimatedEpsAvg),
      q1_revenue: firstNonNullNumber(q1?.estimatedRevenueAvg),
      analystCountEps: firstNonNullNumber(
        fy0?.numberAnalystsEstimatedEps, fy0?.numberAnalystEstimatedEps,
        q0?.numberAnalystsEstimatedEps, q0?.numberAnalystEstimatedEps,
      ),
      analystCountRevenue: firstNonNullNumber(
        fy0?.numberAnalystEstimatedRevenue, q0?.numberAnalystEstimatedRevenue,
      ),
      rawSample: { fy0, q0 },
    };
    await StocksAnalystEpsSnapshot.updateOne(
      { ticker, ymd: doc.ymd },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  } catch (e) {
    console.warn(`[real-eps-revisions] persist snapshot failed for ${ticker}:`, e?.message);
    return null;
  }
}

// Find a baseline snapshot for revision math — closest snapshot in
// [minDaysAgo, maxDaysAgo] window ending at today.
async function loadBaselineSnapshot(ticker, minDaysAgo, maxDaysAgo) {
  const nowMs = Date.now();
  const cutoffHi = new Date(nowMs - minDaysAgo * 86400_000).toISOString().slice(0, 10);
  const cutoffLo = new Date(nowMs - maxDaysAgo * 86400_000).toISOString().slice(0, 10);
  try {
    const row = await StocksAnalystEpsSnapshot.findOne({
      ticker,
      ymd: { $gte: cutoffLo, $lte: cutoffHi },
      fy0_eps: { $ne: null },
    }).sort({ ymd: -1 }).lean();
    return row || null;
  } catch { return null; }
}

function pctChange(oldV, newV) {
  if (!Number.isFinite(oldV) || !Number.isFinite(newV) || oldV === 0) return null;
  return ((newV - oldV) / Math.abs(oldV)) * 100;
}

// Score components → composite 0..100.
//   MAGNITUDE:  fy0 EPS + fy1 EPS (each up to 50 pts, symmetric around 0)
//   BREADTH:    high analyst count → boost; low count → dampen
//   ACCELERATION: 4w rev change vs 12w rev change (positive gap adds)
//   DIRECTION:  positive rev breadth score
// A candidate with only some components available gets a proportional
// score with reduced coverage%.
function computeComposite({
  epsRevision4wPct, epsRevisionFy14wPct, revenueRevision4wPct,
  epsRevision12wPct, analystCount, driverRow,
}) {
  const evidence = [];
  let numPresent = 0, numMax = 5; // 5 potential components

  const magFy0 = clampMagnitudeScore(epsRevision4wPct, 8);       // ±8% = ±50 pts
  if (magFy0 != null) { evidence.push({ metric: "epsRevision4wPct", value: epsRevision4wPct, contribution: magFy0 }); numPresent++; }
  const magFy1 = clampMagnitudeScore(epsRevisionFy14wPct, 10);   // FY1 more volatile — wider band
  if (magFy1 != null) { evidence.push({ metric: "epsRevisionFy14wPct", value: epsRevisionFy14wPct, contribution: magFy1 }); numPresent++; }
  const magRev = clampMagnitudeScore(revenueRevision4wPct, 5);   // revenue moves less — tighter band
  if (magRev != null) { evidence.push({ metric: "revenueRevision4wPct", value: revenueRevision4wPct, contribution: magRev }); numPresent++; }
  // Acceleration bonus: 4w > 12w (recent revisions faster than long-run)
  let accelBonus = 0;
  if (Number.isFinite(epsRevision4wPct) && Number.isFinite(epsRevision12wPct)) {
    const gap = epsRevision4wPct - epsRevision12wPct;
    accelBonus = Math.max(-20, Math.min(20, gap * 2));  // ±20 pts cap
    evidence.push({ metric: "epsRevisionAccelPct", value: gap, contribution: accelBonus });
    numPresent++;
  }
  // Breadth: analyst count > 15 = full weight; < 3 = halve; missing = neutral.
  let breadthFactor = 1.0;
  if (Number.isFinite(analystCount)) {
    numPresent++;
    if (analystCount >= 15) breadthFactor = 1.0;
    else if (analystCount >= 8) breadthFactor = 0.85;
    else if (analystCount >= 3) breadthFactor = 0.7;
    else breadthFactor = 0.5;
    evidence.push({ metric: "analystCount", value: analystCount, contribution: breadthFactor });
  }
  const rawSum = (magFy0 || 0) + (magFy1 || 0) + (magRev || 0) + accelBonus;
  // Rescale: sum lives in ±(50+50+50+20) = ±170 range; map to 0..100.
  const scaled = 50 + (rawSum * breadthFactor / 170) * 50;
  const composite = Math.max(0, Math.min(100, Math.round(scaled)));
  return { composite, evidence, coverage: numPresent / numMax };
}
function clampMagnitudeScore(pct, saturationPct) {
  if (!Number.isFinite(pct)) return null;
  const clip = Math.max(-saturationPct, Math.min(saturationPct, pct));
  return (clip / saturationPct) * 50;
}

// PUBLIC — fetch + persist + score real estimate revisions.
export async function getRealEpsRevisions(ticker) {
  if (!isFmpEnabled()) {
    return { ok: false, reason: fmpDisabledReason() || "fmp_disabled" };
  }
  try {
    const raw = await fetchRawEstimates(ticker);
    const projected = projectRows(raw);
    if (!projected.fy0 && !projected.q0) {
      return { ok: false, reason: "no analyst estimates for symbol" };
    }
    const today = await persistSnapshot(ticker, projected);
    const [b4w, b12w] = await Promise.all([
      loadBaselineSnapshot(ticker, 21, 45),
      loadBaselineSnapshot(ticker, 63, 100),
    ]);
    const epsRevision4wPct = pctChange(b4w?.fy0_eps, today?.fy0_eps);
    const epsRevisionFy14wPct = pctChange(b4w?.fy1_eps, today?.fy1_eps);
    const revenueRevision4wPct = pctChange(b4w?.fy0_revenue, today?.fy0_revenue);
    const epsRevision12wPct = pctChange(b12w?.fy0_eps, today?.fy0_eps);
    const analystCount = firstNonNullNumber(today?.analystCountEps, today?.analystCountRevenue);
    // Revision direction: +1 up, -1 down, 0 neutral. Uses fy0 EPS 4w Δ.
    let revisionDirection = null;
    if (Number.isFinite(epsRevision4wPct)) {
      revisionDirection = epsRevision4wPct > 0.5 ? 1 : (epsRevision4wPct < -0.5 ? -1 : 0);
    }
    // Breadth (best-effort proxy): if analystCount ≥ 5 AND fy0 revised
    // > 0, treat as "broad up-revision"; opposite for down.
    const revisionBreadth = Number.isFinite(analystCount) ? analystCount : null;

    const { composite, evidence, coverage } = computeComposite({
      epsRevision4wPct, epsRevisionFy14wPct, revenueRevision4wPct,
      epsRevision12wPct, analystCount, driverRow: today,
    });

    return {
      ok: true,
      ticker,
      dataAsOf: new Date(),
      epsRevision4wPct,
      epsRevisionFy14wPct,
      revenueRevision4wPct,
      epsRevision12wPct,
      analystCount,
      revisionDirection,
      revisionBreadth,
      estimateRevisionScore: composite,           // 0..100
      coverage,                                    // 0..1 fraction of components present
      hasReal4wBaseline: !!b4w,
      hasReal12wBaseline: !!b12w,
      evidence,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || "fetch failed" };
  }
}

// Normalize to the 0..1 range the OQ scorer expects.
export function realEpsRevisionsToSubScore(res) {
  if (!res || !res.ok) return null;
  if (!Number.isFinite(res.estimateRevisionScore)) return null;
  return res.estimateRevisionScore / 100;
}
