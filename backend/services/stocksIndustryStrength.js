// backend/services/stocksIndustryStrength.js
//
// P2  (2026-09-08) — initial version: peer-median 3m return with a
//                    silent sector fallback.
// P2.5 (2026-09-09) — HARDENED: real peer fetcher wired, minimum peer
//                    count enforced, multi-window metrics computed
//                    (1m/3m/6m), stock-vs-peer breakdown returned,
//                    source explicitly stamped so a sector fallback
//                    can NEVER masquerade as industry confirmation.
//
// Output shape:
//   {
//     score: 0..1 | null,
//     source: "industry-peers" | "sector-fallback" | "unavailable",
//     industry, sector,
//     peerCount,           // number of peers used (null if none)
//     peerMedianReturn1m, peerMedianReturn3m, peerMedianReturn6m,
//     stockReturn1m, stockReturn3m, stockReturn6m,
//     stockVsPeer1m, stockVsPeer3m, stockVsPeer6m,
//     benchReturn3mPct,
//     sectorRank, sectorMomentum1mPct,  // only when source=sector-fallback
//     dataAsOf: Date
//   }
//
// Callers use `source` to weigh confidence. A "sector-fallback" row
// contributes less credibility to Model F (which explicitly cares
// about industry-level RS).

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { fetchPeers } from "./stocksPeerFetcher.js";

const TTL_MS = 60 * 60 * 1000;
const CACHE = new Map();
const MIN_PEER_COUNT = Number(process.env.STOCKS_INDUSTRY_MIN_PEERS || 5);
const MAX_PEER_FETCH = Number(process.env.STOCKS_INDUSTRY_MAX_PEER_FETCH || 12);

function cacheKey(ticker, industry) {
  return `${String(ticker).toUpperCase()}::${String(industry || "").toLowerCase()}`;
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

// PUBLIC
export async function getIndustryStrength(ticker, ctx = {}) {
  if (!ticker) return { score: null, source: "no-ticker" };
  const fund = ctx.fundamentals;
  const industry = fund?.industry || null;
  const sector = fund?.sector || null;
  const key = cacheKey(ticker, industry);
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  // Peer fetcher — inject a custom one for tests, otherwise use real.
  const peerFetcher = ctx.peerFetcher || fetchPeers;
  let data = null;

  try {
    const peers = await peerFetcher(ticker) || [];
    if (peers.length >= MIN_PEER_COUNT) {
      // Fetch bars in parallel — the ticker + up to MAX_PEER_FETCH peers.
      const selectedPeers = peers.slice(0, MAX_PEER_FETCH);
      const [selfBars, ...peerBarsArr] = await Promise.all([
        fetchYahooDaily(ticker, "6mo").catch(() => null),
        ...selectedPeers.map(p => fetchYahooDaily(p, "6mo").catch(() => null)),
      ]);
      const peerReturns1m = peerBarsArr.map(b => returnPct(b, 21)).filter(x => Number.isFinite(x));
      const peerReturns3m = peerBarsArr.map(b => returnPct(b, 63)).filter(x => Number.isFinite(x));
      const peerReturns6m = peerBarsArr.map(b => returnPct(b, 126)).filter(x => Number.isFinite(x));

      if (peerReturns3m.length >= MIN_PEER_COUNT) {
        const peerMedianReturn1m = peerReturns1m.length >= MIN_PEER_COUNT ? median(peerReturns1m) : null;
        const peerMedianReturn3m = median(peerReturns3m);
        const peerMedianReturn6m = peerReturns6m.length >= MIN_PEER_COUNT ? median(peerReturns6m) : null;
        const stockReturn1m = returnPct(selfBars, 21);
        const stockReturn3m = returnPct(selfBars, 63);
        const stockReturn6m = returnPct(selfBars, 126);
        const stockVsPeer1m = (Number.isFinite(stockReturn1m) && Number.isFinite(peerMedianReturn1m)) ? stockReturn1m - peerMedianReturn1m : null;
        const stockVsPeer3m = (Number.isFinite(stockReturn3m) && Number.isFinite(peerMedianReturn3m)) ? stockReturn3m - peerMedianReturn3m : null;
        const stockVsPeer6m = (Number.isFinite(stockReturn6m) && Number.isFinite(peerMedianReturn6m)) ? stockReturn6m - peerMedianReturn6m : null;
        // Composite: 3m peer median vs benchmark → 0..1. -5pp = 0, +5pp = 1.
        const benchBars = ctx.benchmarkTicker
          ? await fetchYahooDaily(ctx.benchmarkTicker, "6mo").catch(() => null) : null;
        const benchReturn3mPct = benchBars ? returnPct(benchBars, 63) : 0;
        const relPct = peerMedianReturn3m - (benchReturn3mPct || 0);
        const score = clamp01((relPct + 5) / 10);
        data = {
          score, source: "industry-peers",
          industry, sector,
          peerCount: peerReturns3m.length,
          peerMedianReturn1m, peerMedianReturn3m, peerMedianReturn6m,
          stockReturn1m, stockReturn3m, stockReturn6m,
          stockVsPeer1m, stockVsPeer3m, stockVsPeer6m,
          benchReturn3mPct,
          dataAsOf: new Date(),
        };
      }
    }
  } catch { /* fall through */ }

  // Sector fallback — EXPLICITLY labeled. Never pretend sector is industry.
  if (!data && ctx.sectorRotation && sector) {
    const secLc = String(sector).toLowerCase();
    const sr = (ctx.sectorRotation.rankings || []).find(r => String(r.sector).toLowerCase() === secLc);
    if (sr && Number.isFinite(sr.momentum1mPct)) {
      const score = clamp01((sr.momentum1mPct + 5) / 10);
      data = {
        score, source: "sector-fallback",
        industry, sector,
        peerCount: null,
        peerMedianReturn1m: null, peerMedianReturn3m: null, peerMedianReturn6m: null,
        stockReturn1m: null, stockReturn3m: null, stockReturn6m: null,
        stockVsPeer1m: null, stockVsPeer3m: null, stockVsPeer6m: null,
        benchReturn3mPct: null,
        sectorRank: sr.rank, sectorMomentum1mPct: sr.momentum1mPct,
        dataAsOf: new Date(),
      };
    }
  }

  if (!data) {
    data = {
      score: null, source: "unavailable",
      industry, sector, peerCount: null, dataAsOf: new Date(),
    };
  }

  CACHE.set(key, { at: Date.now(), data });
  return data;
}
