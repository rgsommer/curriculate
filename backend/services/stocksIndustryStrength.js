// backend/services/stocksIndustryStrength.js
//
// P2 (2026-09-08) — industry relative-strength signal. "Technology"
// is too coarse a bucket to steer selection; "Semiconductors" or
// "Software—Infrastructure" is where the real dispersion lives.
//
// Strategy:
//   1. Ask FMP for the ticker's SECTOR and INDUSTRY (already fetched
//      by getFundamentals — reuse that).
//   2. Look up cached PEER lists (fmp stock-peers) for the ticker;
//      restrict to same industry.
//   3. Aggregate the median 3-month return of the industry peer set
//      relative to the benchmark (SPY for US, XIC.TO for TSX).
//   4. Normalize to 0..1 — > +5pp above bench = 1.0; -5pp below = 0.
//   5. FALLBACK: if we cannot resolve peers, use the ticker's sector
//      3-month return from the sector-rotation service already in
//      the codebase. Report `source: "sector-fallback"` in the return
//      so provenance is clear that industry data wasn't available.
//
// This module never throws — a fetch failure returns { score: null }
// and the caller (opportunity scorer) treats the factor as missing.

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const TTL_MS = 60 * 60 * 1000; // one-hour cache
const CACHE = new Map();

function cacheKey(ticker, industry) {
  return `${String(ticker).toUpperCase()}::${String(industry || "").toLowerCase()}`;
}

// PUBLIC — compute industry-strength score for a ticker.
// Signature:
//   getIndustryStrength(ticker, {
//     fundamentals,       // { sector, industry } from getFundamentals
//     benchmarkTicker,    // "SPY" or "XIC.TO" — matches ticker's currency
//     sectorRotation,     // sectorRotation service snapshot (optional)
//     peerFetcher,        // async (ticker) => string[] (optional)
//   })
export async function getIndustryStrength(ticker, ctx = {}) {
  if (!ticker) return { score: null, source: "no-ticker" };
  const fund = ctx.fundamentals;
  const industry = fund?.industry || null;
  const sector = fund?.sector || null;
  const key = cacheKey(ticker, industry);
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  // Try industry-peer aggregation first.
  let data = null;
  if (industry && typeof ctx.peerFetcher === "function") {
    try {
      const peers = await ctx.peerFetcher(ticker) || [];
      if (peers.length >= 3) {
        const peerReturns = await Promise.all(peers.slice(0, 10).map(async (p) => {
          try {
            const bars = await fetchYahooDaily(p, "6mo");
            return returnPct(bars, 90);
          } catch { return null; }
        }));
        const validReturns = peerReturns.filter(x => Number.isFinite(x));
        if (validReturns.length >= 3) {
          const industryMedian = median(validReturns);
          const benchBars = ctx.benchmarkTicker
            ? await fetchYahooDaily(ctx.benchmarkTicker, "6mo").catch(() => null) : null;
          const benchReturn = benchBars ? returnPct(benchBars, 90) : 0;
          const relPct = industryMedian - (benchReturn || 0);
          const score = clamp01((relPct + 5) / 10); // -5..+5 → 0..1
          data = {
            score, source: "industry-peers", industry, sector,
            industryReturn3mPct: industryMedian, benchReturn3mPct: benchReturn,
            peerCount: validReturns.length,
          };
        }
      }
    } catch (e) {
      // fall through to sector
    }
  }

  // Sector fallback — use pre-computed sector rotation if provided.
  if (!data && ctx.sectorRotation && sector) {
    const secLc = String(sector).toLowerCase();
    const sr = (ctx.sectorRotation.rankings || []).find(r => String(r.sector).toLowerCase() === secLc);
    if (sr && Number.isFinite(sr.momentum1mPct)) {
      // Map 1m momentum to 0..1: -5pp = 0, +5pp = 1.
      const score = clamp01((sr.momentum1mPct + 5) / 10);
      data = {
        score, source: "sector-fallback", industry, sector,
        sectorRank: sr.rank, sectorMomentum1mPct: sr.momentum1mPct,
      };
    }
  }

  if (!data) {
    data = { score: null, source: "unavailable", industry, sector };
  }

  CACHE.set(key, { at: Date.now(), data });
  return data;
}

function returnPct(bars, lookbackDays) {
  if (!Array.isArray(bars) || bars.length < lookbackDays + 1) return null;
  const last = bars[bars.length - 1]?.close;
  const first = bars[bars.length - 1 - lookbackDays]?.close;
  if (!Number.isFinite(last) || !Number.isFinite(first) || first <= 0) return null;
  return ((last - first) / first) * 100;
}
function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
}
function clamp01(x) { return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)); }
