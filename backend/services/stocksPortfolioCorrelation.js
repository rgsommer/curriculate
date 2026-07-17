// backend/services/stocksPortfolioCorrelation.js
//
// Computes pairwise Pearson correlation between every held ticker over the
// last 60 sessions of daily returns. Flags pairs whose correlation exceeds
// 0.7 — meaning they're effectively the same bet under a different symbol.
//
// Also computes a "diversification score" (average pairwise correlation)
// and a "single-factor exposure" flag when >=50% of the portfolio's dollar
// weight is in tickers that are >0.7-correlated with each other.
//
// Used by the /portfolio/correlations endpoint and (optionally) surfaced in
// the daily briefing so the AI can warn about hidden concentration.

import { fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";

const CACHE = new Map(); // key = tickerlist|60 → { fetchedAt, data }
const TTL_MS = 4 * 60 * 60 * 1000;

function pearsonCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const va = a.slice(-n), vb = b.slice(-n);
  const ma = va.reduce((s, x) => s + x, 0) / n;
  const mb = vb.reduce((s, x) => s + x, 0) / n;
  let num = 0, dena = 0, denb = 0;
  for (let i = 0; i < n; i++) {
    const da = va[i] - ma, db = vb[i] - mb;
    num += da * db;
    dena += da * da;
    denb += db * db;
  }
  const denom = Math.sqrt(dena * denb);
  return denom > 0 ? num / denom : null;
}

function toReturns(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]?.close, cur = points[i]?.close;
    if (prev > 0 && cur > 0) out.push((cur - prev) / prev);
  }
  return out;
}

export async function computeCorrelations({ tickers, currencies = {}, weights = {} }) {
  const uniq = [...new Set(tickers.map((t) => String(t).toUpperCase()))].filter(Boolean);
  if (uniq.length < 2) return { pairs: [], highCorr: [], avgAbsCorr: null, singleFactor: false };

  const cacheKey = uniq.slice().sort().join(",") + "|60";
  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && now - cached.fetchedAt < TTL_MS && !weights) {
    return cached.data; // weights-less cached result — recompute if weighted
  }

  // Fetch daily bars per ticker in parallel — currency-aware resolution.
  const returnsByTicker = {};
  await Promise.all(uniq.map(async (t) => {
    try {
      const ccy = currencies[t] || "USD";
      const { points } = await fetchDailyOhlcForBacktest(t, ccy, 100);
      returnsByTicker[t] = toReturns(points).slice(-60);
    } catch { returnsByTicker[t] = []; }
  }));

  const pairs = [];
  const highCorr = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i], b = uniq[j];
      const corr = pearsonCorrelation(returnsByTicker[a], returnsByTicker[b]);
      if (corr == null) continue;
      pairs.push({ a, b, corr });
      if (corr > 0.7) highCorr.push({ a, b, corr });
    }
  }
  pairs.sort((x, y) => Math.abs(y.corr) - Math.abs(x.corr));
  highCorr.sort((x, y) => y.corr - x.corr);

  const avgAbsCorr = pairs.length > 0
    ? pairs.reduce((s, p) => s + Math.abs(p.corr), 0) / pairs.length
    : null;

  // Single-factor exposure: sum weights of tickers that are >0.7-correlated
  // with at least one other holding. If ≥50%, we're basically one bet.
  let singleFactor = false;
  if (weights && Object.keys(weights).length > 0) {
    const correlatedSet = new Set();
    for (const p of highCorr) {
      correlatedSet.add(p.a);
      correlatedSet.add(p.b);
    }
    const total = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0);
    const correlatedWeight = [...correlatedSet].reduce((s, t) => s + (Number(weights[t]) || 0), 0);
    if (total > 0) {
      const concPct = (correlatedWeight / total) * 100;
      singleFactor = concPct >= 50;
    }
  }

  const data = { pairs, highCorr, avgAbsCorr, singleFactor };
  if (!weights || Object.keys(weights).length === 0) {
    CACHE.set(cacheKey, { fetchedAt: now, data });
  }
  return data;
}

export function formatCorrelationBlock(corrs) {
  if (!corrs || !corrs.pairs || corrs.pairs.length === 0) return "";
  const lines = [`\nPORTFOLIO CORRELATION (60d daily returns):`];
  lines.push(`  Avg |corr| across pairs: ${corrs.avgAbsCorr != null ? corrs.avgAbsCorr.toFixed(2) : "—"} · High-corr pairs (>0.7): ${corrs.highCorr.length}`);
  if (corrs.highCorr.length > 0) {
    lines.push(`  ⚠ Concentrated pairs (moving together — one bet in disguise):`);
    for (const p of corrs.highCorr.slice(0, 6)) {
      lines.push(`     ${p.a} ↔ ${p.b}: corr ${p.corr.toFixed(2)}`);
    }
  }
  if (corrs.singleFactor) {
    lines.push(`  🚨 SINGLE-FACTOR EXPOSURE: ≥50% of book is in correlated names. If the underlying factor (e.g. AI beta, rates, oil) reverses, most of the portfolio moves against you simultaneously. Consider diversifying or hedging.`);
  }
  return lines.join("\n");
}
