// backend/services/stocksCorrelationSizing.js
//
// Correlation-adjusted position sizing. When a candidate rec is highly
// correlated (60-day daily-return Pearson) with a holding that is
// already ≥5% of the book, the two positions are effectively one bet.
// This service computes a suggested size multiplier per candidate so
// the briefing prompt can nudge the AI to downsize rather than double
// the existing exposure.
//
// Rules (deliberately conservative — no math beyond what the trader
// can eyeball on the reported numbers):
//
//   max_corr < 0.50                              → 1.00×  (fully independent)
//   0.50 ≤ max_corr < 0.70   AND paired-w ≥ 5%   → 0.75×
//   0.70 ≤ max_corr < 0.85   AND paired-w ≥ 5%   → 0.50×
//   max_corr ≥ 0.85          AND paired-w ≥ 5%   → 0.25×  (redundant)
//
// The "paired-w" gate keeps a high correlation with a tiny leftover
// position (say 0.8% of book) from downsizing a fresh rec that would
// actually be additive.

import { fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - meanA, xb = b[i] - meanB;
    num += xa * xb; dA += xa * xa; dB += xb * xb;
  }
  const den = Math.sqrt(dA * dB);
  return den > 0 ? num / den : null;
}

function toReturns(points) {
  const out = [];
  for (let i = 1; i < (points || []).length; i++) {
    const prev = points[i - 1]?.close, cur = points[i]?.close;
    if (prev > 0 && cur > 0) out.push((cur - prev) / prev);
  }
  return out;
}

// Per-candidate result: { ticker, maxCorr, pairedWith, pairedWeightPct,
// multiplier, note }. multiplier is always in {1.00, 0.75, 0.50, 0.25}.
function classifyMultiplier(maxCorr, pairedWeightPct) {
  const gated = pairedWeightPct != null && pairedWeightPct >= 5;
  if (!gated || maxCorr == null || maxCorr < 0.5) return 1.00;
  if (maxCorr < 0.70) return 0.75;
  if (maxCorr < 0.85) return 0.50;
  return 0.25;
}

// Compute per-candidate sizing adjustments given a set of candidate
// tickers (with their currencies) and the current positions. Returns
// an array — never throws; failed candidates get multiplier=null.
export async function computeSizingAdjustments({
  candidates = [],
  positions = [],
  fxUsdCad = 1.37,
}) {
  if (!candidates.length || !positions.length) return [];

  const totalBookCad = positions.reduce((s, p) => {
    const cad = (p.ccy === "USD" ? (p.priceUsd || 0) * fxUsdCad : (p.priceCad || 0)) * (p.qty || 0);
    return s + cad;
  }, 0);
  if (totalBookCad <= 0) return [];

  const heldTickers = [...new Set(positions.map((p) => String(p.ticker || "").toUpperCase()))].filter(Boolean);
  const heldWeightPct = {};
  const heldCurrency = {};
  for (const p of positions) {
    const t = String(p.ticker || "").toUpperCase();
    heldCurrency[t] = p.ccy || "USD";
    const cad = (p.ccy === "USD" ? (p.priceUsd || 0) * fxUsdCad : (p.priceCad || 0)) * (p.qty || 0);
    heldWeightPct[t] = (heldWeightPct[t] || 0) + (cad / totalBookCad) * 100;
  }

  // Fetch daily returns for every ticker we'll pair (held + candidate).
  const uniqCandidates = [...new Map(candidates.map(c => [String(c.ticker).toUpperCase(), c])).values()];
  const allTickers = [...new Set([...heldTickers, ...uniqCandidates.map(c => String(c.ticker).toUpperCase())])];
  const returnsByTicker = {};
  await Promise.all(allTickers.map(async (t) => {
    try {
      const ccy = heldCurrency[t] || uniqCandidates.find(c => String(c.ticker).toUpperCase() === t)?.currency || "USD";
      const { points } = await fetchDailyOhlcForBacktest(t, ccy, 100);
      returnsByTicker[t] = toReturns(points).slice(-60);
    } catch { returnsByTicker[t] = []; }
  }));

  const results = [];
  for (const cand of uniqCandidates) {
    const candT = String(cand.ticker).toUpperCase();
    const candReturns = returnsByTicker[candT] || [];
    if (candReturns.length < 30) {
      results.push({ ticker: candT, maxCorr: null, pairedWith: null, pairedWeightPct: null, multiplier: 1.00, note: "insufficient history" });
      continue;
    }
    let best = { corr: null, held: null, weightPct: 0 };
    for (const held of heldTickers) {
      if (held === candT) continue;
      const heldReturns = returnsByTicker[held];
      if (!heldReturns || heldReturns.length < 30) continue;
      const c = pearson(candReturns, heldReturns);
      if (c == null) continue;
      if (best.corr == null || c > best.corr) best = { corr: c, held, weightPct: heldWeightPct[held] || 0 };
    }
    const multiplier = classifyMultiplier(best.corr, best.weightPct);
    const note = best.corr == null
      ? "no held-position return series"
      : (multiplier < 1
        ? `max corr ${best.corr.toFixed(2)} with ${best.held} (${best.weightPct.toFixed(1)}% of book) — downsize`
        : `max corr ${best.corr.toFixed(2)} with ${best.held} (${best.weightPct.toFixed(1)}% of book) — independent`);
    results.push({
      ticker: candT,
      maxCorr: best.corr,
      pairedWith: best.held,
      pairedWeightPct: best.weightPct,
      multiplier,
      note,
    });
  }
  return results;
}

export function formatSizingAdjustmentBlock(rows) {
  if (!rows || rows.length === 0) return "";
  const downsized = rows.filter((r) => r.multiplier < 1);
  if (downsized.length === 0) return "";
  const lines = [`\nCORRELATION-ADJUSTED SIZING (for today's candidate ideas):`];
  for (const r of rows) {
    if (r.multiplier == null) continue;
    const tag = r.multiplier === 1 ? "" : ` · SIZE ${(r.multiplier * 100).toFixed(0)}%`;
    lines.push(`  ${r.ticker}: ${r.note}${tag}`);
  }
  lines.push(`\nHow to use:`);
  lines.push(`  - "SIZE 75%" / "SIZE 50%" / "SIZE 25%" means the candidate is correlated with a substantial holding — reduce the rec's share count (and cash allocation) by that ratio so total factor exposure doesn't compound.`);
  lines.push(`  - Cite the specific pairing when downsizing: "half-size vs full, because 0.78 correlated with your ENB position that's 22% of book."`);
  lines.push(`  - Rows without a downsize tag are safely independent — full size OK.`);
  return lines.join("\n");
}
