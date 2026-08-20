// backend/services/stocksRecAlpha.js
//
// Phase 2 of the Stocks Advisor rewrite: honest performance measurement.
//
// This measures the ADVICE ENGINE itself, not the user's execution. The
// question we're trying to answer for the next 2-4 weeks is: does the
// engine actually produce alpha, or would you have been better off in
// SPY / QQQ / XIC?
//
// Method:
//   1. Pull every rec (open + closed) in a lookback window.
//   2. For each rec, compute the outcome return:
//        • closed (target/stop/expired) → hit price vs entry price
//        • open                          → current price vs entry price
//      All signed to the intended direction (BUY = long, SELL/TRIM = short-ish).
//   3. Bucket by source / setup / sleeve / regime-at-emit and compute:
//        n, hit rate, avg return, median return, avg holding days,
//        95% CI on the mean via normal-approximation SE (bootstrap
//        is nicer but 100+ recs is enough for CLT to give a sane band).
//   4. Compute "rec-population alpha" — the equal-weighted average
//      return of all recs in a window, minus SPY / QQQ / XIC return over
//      the same window. Positive → engine is beating boring; negative
//      → cash the ideas, buy the ETF.
//
// Design constraints from the user's spec:
//   • Numbers come from CODE, not the LLM. Every stat here is
//     deterministic given the rec population.
//   • Honest denominators: SELL/TRIM/EXIT recs don't count in the alpha
//     calc (they close existing exposure, not "picks that would have
//     compounded"). Their outcomes ARE tracked per-source for hit-rate.
//   • No lookahead: closedAt / hitAt < endOfWindow always.
//   • Confidence bands: any bucket with n<10 is flagged low-confidence.

import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";

const MIN_BUCKET_N = 5;               // hide buckets thinner than this
const LOW_CONFIDENCE_N = 10;          // flag but show buckets 5-9
const DEFAULT_LOOKBACK_DAYS = 90;
const BENCHMARK_TICKERS = ["SPY", "QQQ", "XIC.TO"];
const BENCHMARK_CACHE = new Map();    // ticker → { at, map }
const BENCHMARK_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

async function benchmarkDailyMap(ticker) {
  const now = Date.now();
  const hit = BENCHMARK_CACHE.get(ticker);
  if (hit && now - hit.at < BENCHMARK_CACHE_TTL_MS) return hit.map;
  const points = await fetchYahooDaily(ticker, "1y").catch(() => null);
  if (!points) return null;
  const map = new Map();
  for (const p of points) {
    const ymd = new Date(p.t * 1000).toISOString().slice(0, 10);
    map.set(ymd, p.close);
  }
  BENCHMARK_CACHE.set(ticker, { at: now, map });
  return map;
}

// Signed return: BUY of X at 100, now at 110 → +10%. SELL of X at 100,
// now at 90 → +10% (the exit was correct). SELL of X at 100, now at 110
// → -10% (the exit was wrong; would've kept gains by holding).
function signedReturnPct(rec, exitPrice) {
  if (!Number.isFinite(rec.entryPrice) || rec.entryPrice <= 0) return null;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null;
  const raw = ((exitPrice - rec.entryPrice) / rec.entryPrice) * 100;
  const isLong = rec.action === "BUY" || rec.action === "HOLD";
  return isLong ? raw : -raw;
}

// Days a rec was "in the market" for outcome purposes. Closed recs use
// hitAt; open recs use "now". Minimum 1 to avoid div-by-zero in
// per-day stats.
function holdingDays(rec, asOf) {
  const start = rec.generatedAt ? new Date(rec.generatedAt) : null;
  const end = rec.hitAt ? new Date(rec.hitAt) : (rec.lastCheckedAt ? new Date(rec.lastCheckedAt) : asOf);
  if (!start || !end) return null;
  return Math.max(1, Math.round((end - start) / 86400000));
}

// Regime bucket at rec-emit time. We don't currently persist the regime
// snapshot on the rec, so infer coarsely from the sourceLabel / other
// per-rec metadata. Future improvement: stamp regime at emit-time on
// the rec so this becomes exact.
function regimeBucket(rec) {
  const s = String(rec.sourceLabel || "").toLowerCase();
  if (s.includes("intraday")) return "intraday-update";
  if (s.includes("recap")) return "eod-recap";
  if (s.includes("briefing")) return "morning-briefing";
  if (s.includes("discovery")) return "discovery-scan";
  if (s.includes("pick") || s.includes("test-a")) return "test-a-pick";
  return "other";
}

// Std-error → 95% CI (normal approximation). For nb <10 CI is wide
// anyway; we mostly use this for the medium-n buckets.
function mean95CI(values) {
  if (!values.length) return { mean: null, ci95: null };
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  if (values.length < 2) return { mean, ci95: null };
  const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1);
  const se = Math.sqrt(variance / values.length);
  const halfWidth = 1.96 * se;
  return { mean, ci95: [mean - halfWidth, mean + halfWidth], se };
}

// Bucket a flat items[] array by keyFn; each bucket returns
// { key, n, hitRate, meanReturn, medianReturn, ci95, avgHoldingDays,
//   confidence: "high"|"medium"|"low" }.
function bucketize(items, keyFn) {
  const groups = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  for (const [key, arr] of groups.entries()) {
    if (arr.length < MIN_BUCKET_N) continue;
    const returns = arr.map(x => Number(x.returnPct)).filter(Number.isFinite);
    if (returns.length === 0) continue;
    const sortedRet = [...returns].sort((a, b) => a - b);
    const median = sortedRet.length % 2 === 1
      ? sortedRet[(sortedRet.length - 1) / 2]
      : (sortedRet[sortedRet.length / 2 - 1] + sortedRet[sortedRet.length / 2]) / 2;
    const wins = returns.filter(r => r > 0).length;
    const days = arr.map(x => x.holdingDays).filter(Number.isFinite);
    const avgDays = days.length ? days.reduce((s, x) => s + x, 0) / days.length : null;
    const { mean, ci95, se } = mean95CI(returns);
    out.push({
      key,
      n: arr.length,
      hitRate: returns.length ? wins / returns.length : null,
      meanReturn: mean,
      medianReturn: median,
      ci95,
      standardError: se,
      avgHoldingDays: avgDays,
      confidence: arr.length >= 30 ? "high" : (arr.length >= LOW_CONFIDENCE_N ? "medium" : "low"),
      openCount: arr.filter(x => x.status === "open").length,
      closedCount: arr.filter(x => x.status !== "open").length,
    });
  }
  out.sort((a, b) => (b.n - a.n));
  return out;
}

// Load recent recs and enrich each with the outcome fields the
// bucketizer wants. Non-BUY recs (SELL/TRIM/EXIT/HOLD) are still
// tracked but they don't count in the alpha comparison — flag them
// via `excludeFromAlpha: true`.
async function loadRecsWithOutcomes({ email, lookbackDays, asOf }) {
  const since = new Date(asOf.getTime() - lookbackDays * 86400000);
  const raw = await StocksAdviceRec.find({
    email,
    generatedAt: { $gte: since },
  }).lean();

  const enriched = [];
  for (const rec of raw) {
    const closedPrice = rec.hitPrice != null ? rec.hitPrice : rec.lastCheckedPrice;
    const exitPrice = rec.status === "open"
      ? (rec.lastCheckedPrice != null ? rec.lastCheckedPrice : null)
      : (closedPrice != null ? closedPrice : rec.lastCheckedPrice);
    if (exitPrice == null) continue;
    const returnPct = signedReturnPct(rec, exitPrice);
    if (returnPct == null) continue;
    const setupName = normalizeSetupFromRec(rec);
    const sleeveKey = rec.sleeve || safeClassify(rec);
    enriched.push({
      _id: rec._id,
      ticker: rec.ticker,
      action: rec.action,
      status: rec.status,
      generatedAt: rec.generatedAt,
      hitAt: rec.hitAt,
      entryPrice: rec.entryPrice,
      exitPrice,
      returnPct,
      holdingDays: holdingDays(rec, asOf),
      source: rec.source || "ai",
      sourceLabel: rec.sourceLabel || null,
      regime: regimeBucket(rec),
      setup: setupName,
      sleeve: sleeveKey || "unclassified",
      excludeFromAlpha: rec.action !== "BUY" && rec.action !== "HOLD",
    });
  }
  return enriched;
}

function normalizeSetupFromRec(rec) {
  // Attempt to pull a setup label from the rationale text — the daily-
  // pick engine stamps a `setupName` on picks but not on plain briefing
  // recs. Best-effort; falls to "unnamed" if nothing matches.
  const src = `${rec.rationale || ""} ${rec.sourceLabel || ""}`.toLowerCase();
  if (src.includes("vcp")) return "vcp";
  if (src.includes("bull flag") || src.includes("flag")) return "bull-flag";
  if (src.includes("pocket pivot")) return "pocket-pivot";
  if (src.includes("coiled") || src.includes("spring")) return "coiled-spring";
  if (src.includes("inside day") || src.includes("inside bar")) return "inside-day";
  if (src.includes("cup") && src.includes("handle")) return "cup-and-handle";
  if (src.includes("breakout")) return "breakout";
  if (src.includes("pullback")) return "pullback";
  if (src.includes("mean revert") || src.includes("reversion")) return "mean-reversion";
  return "unnamed";
}

function safeClassify(rec) {
  try {
    const r = classifyPosition({ ticker: rec.ticker }, {});
    return r?.sleeve || null;
  } catch { return null; }
}

// Rec-population alpha vs benchmarks — RECOMMENDATION-MATCHED window.
//
// The previous version compared the mean rec return against the
// benchmark's return over the entire lookback window. That was
// apples-to-oranges: a rec generated 8 days ago and a rec generated
// 88 days ago were both compared to the same 90-day SPY return.
//
// Correct method (per audit feedback #3):
//   for each rec r in window:
//     bench_r = benchmark return over [r.generatedAt, r.exitOrAsOf]
//     alpha_r = r.returnPct - bench_r
//   report average alpha_r (with SE for a proper CI)
//
// This makes each rec its own honest comparison — "would you have done
// better in SPY over the same holding period?" — and prevents the
// misleading "engine +4% vs SPY +12%" artifact when the engine's recs
// were all short-lived recent trades and SPY was up over the long
// period.
async function computeAlphaVsBenchmarks({ recs, windowDays, asOf }) {
  const windowStart = new Date(asOf.getTime() - windowDays * 86400000);
  const inWindow = recs.filter(r => {
    if (r.excludeFromAlpha) return false;
    const t = new Date(r.generatedAt);
    return t >= windowStart && t <= asOf;
  });
  if (inWindow.length === 0) {
    return { windowDays, n: 0, meanRecReturn: null, meanBenchmark: {}, meanAlpha: {}, alphaSE: {}, alphaCI95: {} };
  }
  const meanRecReturn = inWindow.reduce((s, r) => s + r.returnPct, 0) / inWindow.length;

  // Load benchmark maps once; reuse across recs.
  const benchMaps = {};
  for (const bench of BENCHMARK_TICKERS) {
    benchMaps[bench] = await benchmarkDailyMap(bench).catch(() => null);
  }

  // Per-rec alpha arrays, one per benchmark.
  const perBenchAlphas = Object.fromEntries(BENCHMARK_TICKERS.map(b => [b, []]));
  const perBenchReturns = Object.fromEntries(BENCHMARK_TICKERS.map(b => [b, []]));

  for (const r of inWindow) {
    const startTs = new Date(r.generatedAt);
    // Exit time: hitAt if closed; else asOf for still-open recs.
    const exitTs = r.hitAt ? new Date(r.hitAt) : asOf;
    // Sanity: exit must be after start; otherwise skip this rec.
    if (!(exitTs > startTs)) continue;
    const startYmd = startTs.toISOString().slice(0, 10);
    const endYmd = exitTs.toISOString().slice(0, 10);

    for (const bench of BENCHMARK_TICKERS) {
      const map = benchMaps[bench];
      if (!map) continue;
      const startClose = findAtOrBefore(map, startYmd);
      const endClose = findAtOrBefore(map, endYmd);
      if (!Number.isFinite(startClose) || !Number.isFinite(endClose) || startClose <= 0) continue;
      const benchReturn = ((endClose - startClose) / startClose) * 100;
      perBenchReturns[bench].push(benchReturn);
      perBenchAlphas[bench].push(r.returnPct - benchReturn);
    }
  }

  const meanBenchmark = {};
  const meanAlpha = {};
  const alphaSE = {};
  const alphaCI95 = {};
  const alphaN = {};

  for (const bench of BENCHMARK_TICKERS) {
    const alphas = perBenchAlphas[bench];
    const rets = perBenchReturns[bench];
    if (alphas.length === 0) {
      meanBenchmark[bench] = null;
      meanAlpha[bench] = null;
      alphaSE[bench] = null;
      alphaCI95[bench] = null;
      alphaN[bench] = 0;
      continue;
    }
    const meanRet = rets.reduce((s, x) => s + x, 0) / rets.length;
    const meanAlp = alphas.reduce((s, x) => s + x, 0) / alphas.length;
    meanBenchmark[bench] = meanRet;
    meanAlpha[bench] = meanAlp;
    alphaN[bench] = alphas.length;
    if (alphas.length >= 2) {
      const variance = alphas.reduce((s, x) => s + (x - meanAlp) ** 2, 0) / (alphas.length - 1);
      const se = Math.sqrt(variance / alphas.length);
      alphaSE[bench] = se;
      alphaCI95[bench] = [meanAlp - 1.96 * se, meanAlp + 1.96 * se];
    } else {
      alphaSE[bench] = null;
      alphaCI95[bench] = null;
    }
  }

  return {
    windowDays,
    n: inWindow.length,
    meanRecReturn,
    meanBenchmark,
    meanAlpha,
    alphaSE,
    alphaCI95,
    alphaN,
    method: "rec-matched-window",
    // Legacy keys retained for backward-compatibility with any consumer
    // that hasn't migrated to the new field names.
    benchmarks: meanBenchmark,
    alpha: meanAlpha,
  };
}

function findAtOrBefore(map, ymd) {
  let bestYmd = null;
  let bestClose = null;
  for (const [k, v] of map) {
    if (k <= ymd && (!bestYmd || k > bestYmd)) { bestYmd = k; bestClose = v; }
  }
  return bestClose;
}

// Entry point: compute the full alpha rollup for one user.
export async function computeRecAlpha({ email, lookbackDays = DEFAULT_LOOKBACK_DAYS, asOf = new Date() }) {
  if (!email) return null;
  const recs = await loadRecsWithOutcomes({ email, lookbackDays, asOf });
  if (recs.length === 0) {
    return {
      email,
      asOf: asOf.toISOString(),
      lookbackDays,
      totalRecs: 0,
      note: "No recs with entry/exit data yet — the engine needs to produce a few recs before alpha can be measured.",
    };
  }

  const bySource = bucketize(recs, r => r.sourceLabel || r.source);
  const bySetup = bucketize(recs, r => r.setup);
  const bySleeve = bucketize(recs, r => r.sleeve);
  const byRegime = bucketize(recs, r => r.regime);
  const byAction = bucketize(recs, r => r.action);

  const alphaWindows = await Promise.all([7, 30, 90].map(w =>
    computeAlphaVsBenchmarks({ recs, windowDays: w, asOf })
  ));

  const openCount = recs.filter(r => r.status === "open").length;
  const closedCount = recs.length - openCount;

  const recent = [...recs].sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)).slice(0, 25);

  return {
    email,
    asOf: asOf.toISOString(),
    lookbackDays,
    totalRecs: recs.length,
    openCount,
    closedCount,
    alphaWindows,
    bySource,
    bySetup,
    bySleeve,
    byRegime,
    byAction,
    recentRecs: recent.map(r => ({
      ticker: r.ticker,
      action: r.action,
      status: r.status,
      source: r.sourceLabel || r.source,
      generatedAt: r.generatedAt,
      hitAt: r.hitAt,
      entryPrice: r.entryPrice,
      exitPrice: r.exitPrice,
      returnPct: r.returnPct,
      holdingDays: r.holdingDays,
      setup: r.setup,
      sleeve: r.sleeve,
    })),
    // Meta so the UI can flag "still warming up" vs "meaningful sample":
    sampleQuality: recs.length >= 100 ? "sufficient" : (recs.length >= 30 ? "warming-up" : "insufficient"),
  };
}
