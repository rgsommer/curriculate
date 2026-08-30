// backend/services/stocksGrowthRevisions.js
//
// Feeds the two "neutral by default" factor buckets in the multi-factor
// composite: growth acceleration + EPS estimate revisions.
//
// Growth (from FMP /income-statement quarter):
//   revenueYoYPct     = (Q0.rev - Q4.rev) / Q4.rev × 100   (this quarter vs 4Q ago)
//   revenueAccelPp    = YoY(Q0) - YoY(Q1)                   (percentage-point delta)
//   epsYoYPct         = (Q0.eps - Q4.eps) / |Q4.eps| × 100  (signed, guarded)
//
// Estimate revisions (from FMP /price-target-consensus + our own
// day-snapshot Mongo history):
//   Every fetch persists today's targetConsensus into a per-day
//   collection. If a snapshot from ~4 weeks ago exists, we compute
//   epsRev4wPct = pct-change in the consensus target as our proxy
//   for "analysts revising higher/lower." First-run tickers return
//   null (multi-factor scorer treats null as neutral 0.5, which is
//   honest — we don't have the history yet).
//
// Both fetches are cached in-process for 6h so a Stage-2 batch of 30
// candidates doesn't burn API quota re-fetching.

import mongoose from "mongoose";
import { isFmpEnabled } from "./fmpEnabled.js";

const GROWTH_CACHE = new Map();     // ticker → { at, data }
const REVISION_CACHE = new Map();   // ticker → { at, data }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ─── Mongo — daily price-target snapshot per ticker ──────────────────
const AnalystTargetSnapshotSchema = new mongoose.Schema({
  ticker: { type: String, required: true, index: true },
  ymd: { type: String, required: true, index: true },
  targetConsensus: { type: Number, default: null },
  targetHigh: { type: Number, default: null },
  targetLow: { type: Number, default: null },
  targetMedian: { type: Number, default: null },
  numAnalysts: { type: Number, default: null },
  fetchedAt: { type: Date, default: Date.now },
}, { collection: "stocks_analyst_target_snapshots" });
AnalystTargetSnapshotSchema.index({ ticker: 1, ymd: 1 }, { unique: true });
const AnalystTargetSnapshot = mongoose.models.AnalystTargetSnapshot
  || mongoose.model("AnalystTargetSnapshot", AnalystTargetSnapshotSchema);

function ymdKey(d = new Date()) { return d.toISOString().slice(0, 10); }

async function fmpFetch(path) {
  const key = process.env.FMP_API_KEY || "";
  if (!key) return null;
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(tid); }
}

// ─── Growth ──────────────────────────────────────────────────────────
// Returns comprehensive change-detection payload (audit Aug-28 Tier 2.2):
//   { ok,
//     revenueYoYPct, revenueAccelPp,           // (existing)
//     epsYoYPct, epsAccelPp,                    // NEW: 2nd derivative of EPS growth
//     grossMarginQ0Pct, grossMarginExpansionPp, // NEW: margin expansion vs same Q year-ago
//     opMarginQ0Pct,    opMarginExpansionPp,    // NEW: op margin expansion
//     fcfMarginQ0Pct,   fcfConversionTrendPp,   // NEW: FCF/revenue trend (Q0 vs Q4)
//     latestQuarterEnd }
// Every field is null if not computable — consumers gate on Number.isFinite.
export async function getGrowth(ticker) {
  if (!isFmpEnabled()) return { ok: false, reason: "fmp disabled" };
  const now = Date.now();
  const cached = GROWTH_CACHE.get(ticker);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  // Need 8 quarters of income to compute Q0/Q1 YoY + acceleration, plus
  // Q4 for margin expansion (this Q vs same Q year-ago). We fetch cash-
  // flow in parallel for FCF conversion trend.
  const [incomeRows, cashFlowRows] = await Promise.all([
    fmpFetch(`/api/v3/income-statement/${encodeURIComponent(ticker)}?period=quarter&limit=8`),
    fmpFetch(`/api/v3/cash-flow-statement/${encodeURIComponent(ticker)}?period=quarter&limit=8`).catch(() => null),
  ]);
  const arr = Array.isArray(incomeRows) ? incomeRows : [];
  if (arr.length < 5) {
    const data = { ok: false, reason: `insufficient quarters (${arr.length})` };
    GROWTH_CACHE.set(ticker, { at: now, data });
    return data;
  }
  const [q0, q1, q2, q3, q4] = arr;
  const rev = (q) => Number(q?.revenue) || null;
  const eps = (q) => Number(q?.eps) || null;
  const gp = (q) => Number(q?.grossProfit) || null;
  const opInc = (q) => Number(q?.operatingIncome) || null;

  const yoyRev = (curr, prior) => {
    const c = rev(curr), p = rev(prior);
    if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
    return ((c - p) / p) * 100;
  };
  const revYoYQ0 = yoyRev(q0, q4);
  const revYoYQ1 = q1 && arr.length >= 6 ? yoyRev(q1, arr[5]) : null;
  const revenueAccelPp = (Number.isFinite(revYoYQ0) && Number.isFinite(revYoYQ1)) ? (revYoYQ0 - revYoYQ1) : null;

  const eps0 = eps(q0), eps4 = eps(q4);
  const epsYoYPct = (Number.isFinite(eps0) && Number.isFinite(eps4) && Math.abs(eps4) > 0.01)
    ? ((eps0 - eps4) / Math.abs(eps4)) * 100
    : null;

  // EPS acceleration (2nd derivative): this quarter's YoY growth rate
  // minus the prior quarter's YoY growth rate. Positive = growth is
  // accelerating (leading indicator of an earnings inflection).
  const eps1 = q1 ? eps(q1) : null;
  const eps5 = arr[5] ? eps(arr[5]) : null;
  const epsYoYQ1 = (Number.isFinite(eps1) && Number.isFinite(eps5) && Math.abs(eps5) > 0.01)
    ? ((eps1 - eps5) / Math.abs(eps5)) * 100
    : null;
  const epsAccelPp = (Number.isFinite(epsYoYPct) && Number.isFinite(epsYoYQ1))
    ? (epsYoYPct - epsYoYQ1) : null;

  // Margin expansion (Q0 vs Q4, same-quarter year-ago). Uses percentage
  // points, not percent-change, so an expansion from 30% → 35% reads
  // as +5pp (not "+16.67%"). Signed: negative = compression.
  const grossMarginPct = (q) => {
    const g = gp(q), r = rev(q);
    return (Number.isFinite(g) && Number.isFinite(r) && r > 0) ? (g / r) * 100 : null;
  };
  const opMarginPct = (q) => {
    const o = opInc(q), r = rev(q);
    return (Number.isFinite(o) && Number.isFinite(r) && r > 0) ? (o / r) * 100 : null;
  };
  const grossMarginQ0Pct = grossMarginPct(q0);
  const grossMarginQ4Pct = grossMarginPct(q4);
  const grossMarginExpansionPp = (Number.isFinite(grossMarginQ0Pct) && Number.isFinite(grossMarginQ4Pct))
    ? (grossMarginQ0Pct - grossMarginQ4Pct) : null;
  const opMarginQ0Pct = opMarginPct(q0);
  const opMarginQ4Pct = opMarginPct(q4);
  const opMarginExpansionPp = (Number.isFinite(opMarginQ0Pct) && Number.isFinite(opMarginQ4Pct))
    ? (opMarginQ0Pct - opMarginQ4Pct) : null;

  // FCF conversion trend — FCF/revenue this Q vs same Q year-ago.
  // FMP cash-flow statement's `freeCashFlow` is the direct FCF figure.
  // Positive trend = a business converting more of its revenue to
  // cash — often the earliest signal of operating leverage.
  const cfArr = Array.isArray(cashFlowRows) ? cashFlowRows : [];
  const cfByDate = new Map();
  for (const c of cfArr) if (c?.date) cfByDate.set(c.date, c);
  const fcfMarginFor = (incomeQ) => {
    if (!incomeQ?.date) return null;
    const cf = cfByDate.get(incomeQ.date);
    const fcf = Number(cf?.freeCashFlow);
    const r = rev(incomeQ);
    return (Number.isFinite(fcf) && Number.isFinite(r) && r > 0) ? (fcf / r) * 100 : null;
  };
  const fcfMarginQ0Pct = fcfMarginFor(q0);
  const fcfMarginQ4Pct = fcfMarginFor(q4);
  const fcfConversionTrendPp = (Number.isFinite(fcfMarginQ0Pct) && Number.isFinite(fcfMarginQ4Pct))
    ? (fcfMarginQ0Pct - fcfMarginQ4Pct) : null;

  const data = {
    ok: true,
    revenueYoYPct: revYoYQ0,
    revenueAccelPp,
    epsYoYPct,
    epsAccelPp,
    grossMarginQ0Pct,
    grossMarginExpansionPp,
    opMarginQ0Pct,
    opMarginExpansionPp,
    fcfMarginQ0Pct,
    fcfConversionTrendPp,
    latestQuarterEnd: q0?.date || null,
  };
  GROWTH_CACHE.set(ticker, { at: now, data });
  return data;
}

// ─── Estimate revisions ──────────────────────────────────────────────
// Snapshot today's price-target consensus, then compare against the
// oldest snapshot within the last 28-45 days to estimate the 4w
// revision direction/magnitude. Returns { ok, epsRev4wPct } where
// epsRev4wPct is the % change in the target consensus (proxy for
// "analysts revising up/down"). ok:false when we don't have enough
// history yet — first-run tickers return neutral downstream.
export async function getEstimateRevisions(ticker) {
  if (!isFmpEnabled()) return { ok: false, reason: "fmp disabled" };
  const now = Date.now();
  const cached = REVISION_CACHE.get(ticker);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  // Fetch today's consensus.
  const consensus = await fmpFetch(`/api/v3/price-target-consensus/${encodeURIComponent(ticker)}`);
  const row = Array.isArray(consensus) ? consensus[0] : (consensus?.symbol ? consensus : null);
  const targetConsensus = Number(row?.targetConsensus) || null;
  const targetMedian = Number(row?.targetMedian) || null;
  const targetHigh = Number(row?.targetHigh) || null;
  const targetLow = Number(row?.targetLow) || null;

  // Persist today's snapshot (best-effort; failure doesn't block the
  // revision calc — we might just miss a data point tomorrow).
  const today = ymdKey();
  if (targetConsensus != null) {
    try {
      await AnalystTargetSnapshot.updateOne(
        { ticker, ymd: today },
        { $set: { targetConsensus, targetMedian, targetHigh, targetLow, fetchedAt: new Date() } },
        { upsert: true }
      );
    } catch { /* ignore */ }
  }

  // Compare against a 4-week-old snapshot. Accept anything between 21-45
  // days ago so weekend/holiday gaps don't leave us with no baseline.
  let epsRev4wPct = null;
  try {
    const cutoffLo = new Date(now - 45 * 86400_000).toISOString().slice(0, 10);
    const cutoffHi = new Date(now - 21 * 86400_000).toISOString().slice(0, 10);
    const historical = await AnalystTargetSnapshot.findOne({
      ticker,
      ymd: { $gte: cutoffLo, $lte: cutoffHi },
      targetConsensus: { $ne: null },
    }).sort({ ymd: -1 }).lean();
    if (historical && Number.isFinite(targetConsensus) && Number.isFinite(historical.targetConsensus) && historical.targetConsensus > 0) {
      epsRev4wPct = ((targetConsensus - historical.targetConsensus) / historical.targetConsensus) * 100;
    }
  } catch { /* ignore */ }

  const data = epsRev4wPct != null
    ? { ok: true, epsRev4wPct, targetConsensusNow: targetConsensus }
    : { ok: false, reason: "no 4w-old baseline yet", targetConsensusNow: targetConsensus };
  REVISION_CACHE.set(ticker, { at: now, data });
  return data;
}
