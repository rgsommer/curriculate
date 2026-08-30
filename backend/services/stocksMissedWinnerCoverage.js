// backend/services/stocksMissedWinnerCoverage.js
//
// Missed-winner coverage KPI (Tier 2.3 audit Aug-28). The single
// measurement that answers "is the discovery engine working?"
//
// Method:
//   1. Snapshot the current broad universe (getBroadUniverse) as the
//      reference denominator — the set of names we could plausibly
//      have discovered.
//   2. For each ticker, compute the trailing 5-trading-day return
//      from Yahoo daily bars.
//   3. Rank descending; the top decile is the "winners" set for the
//      week.
//   4. Attribute each winner:
//        • in-universe  — appeared in StocksDiscoveryCandidate scans
//          in the last 60 days OR was fetched by the pick engine
//        • in-discovery — appeared as a discovery candidate
//        • caught-early — a persisted BUY rec in StocksAdviceRec exists
//          for the ticker with generatedAt BEFORE the observation
//          window (so the rec was actually made ahead of the move)
//        • missed       — none of the above
//   5. Persist a single StocksMissedWinnerCoverage doc keyed by
//      asOfDate. Coverage % = inEither / topDecileCount × 100.
//
// Cost — the expensive step is fetching daily bars for the broad
// universe. Bounded by capping the sample to `MAX_TICKERS_TO_SAMPLE`
// (default 400) — the sampled subset is deterministic (first N of
// the sorted universe) so day-over-day snapshots stay comparable.
//
// Runs daily via jobs/stocksCoverageKpiCron.js at 05:30 America/
// Toronto (after external-nominations sync, before daily briefings).

import StocksMissedWinnerCoverage from "../models/StocksMissedWinnerCoverage.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { getBroadUniverse } from "./stocksUniverse.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const MAX_TICKERS_TO_SAMPLE = Number(process.env.STOCKS_COVERAGE_SAMPLE_CAP) || 400;
const LOOKBACK_DAYS = 60;               // "in our recent universe" window
const CATCH_EARLY_LOOKBACK_DAYS = 45;   // "caught before it moved" window
const TOP_DECILE_PCT = 10;
const WEEK_TRADING_DAYS = 5;
const SAMPLES_TO_STORE = 50;

function weeklyReturnFromBars(bars) {
  if (!Array.isArray(bars) || bars.length < WEEK_TRADING_DAYS + 1) return null;
  const last = bars[bars.length - 1]?.close;
  const then = bars[bars.length - 1 - WEEK_TRADING_DAYS]?.close;
  if (!Number.isFinite(last) || !Number.isFinite(then) || then <= 0) return null;
  return ((last - then) / then) * 100;
}

// Concurrency-bounded parallel map. Yahoo doesn't rate-limit hard but
// 400 concurrent fetches is uncivil.
async function pmap(items, worker, conc = 8) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(conc, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await worker(items[i], i); } catch { results[i] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function computeMissedWinnerCoverage({ asOfDate = null, sampleCap = MAX_TICKERS_TO_SAMPLE } = {}) {
  const observedAt = new Date();
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  const runStart = Date.now();

  // 1) Reference universe
  let universe;
  try {
    universe = await getBroadUniverse();
  } catch (e) {
    return await persistFailure(observedAt, asOf, `broad-universe fetch failed: ${e?.message}`);
  }
  if (!Array.isArray(universe) || universe.length === 0) {
    return await persistFailure(observedAt, asOf, "broad-universe empty");
  }
  const sampled = universe.slice(0, sampleCap);

  // 2) Weekly returns for sampled tickers
  const returns = await pmap(sampled, async (ticker) => {
    const bars = await fetchYahooDaily(ticker, "1mo").catch(() => null);
    const r = weeklyReturnFromBars(bars);
    return r == null ? null : { ticker, weeklyReturnPct: r };
  }, 8);
  const measured = returns.filter(Boolean);
  if (measured.length === 0) {
    return await persistFailure(observedAt, asOf, "no measured returns (Yahoo unreachable?)");
  }

  // 3) Top-decile cutoff
  measured.sort((a, b) => b.weeklyReturnPct - a.weeklyReturnPct);
  const topN = Math.max(1, Math.ceil((measured.length * TOP_DECILE_PCT) / 100));
  const winners = measured.slice(0, topN);
  const winnerBases = new Set(winners.map(w => baseOf(w.ticker)));

  // 4a) In-universe: tickers scanned recently by pick engine (proxy:
  //     StocksDiscoveryCandidate scanDate in last N days OR
  //     StocksAdviceRec generatedAt in last N days). We union both.
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000);
  const [discoveryTickers, recTickers] = await Promise.all([
    StocksDiscoveryCandidate.find({ scanDate: { $gte: since } })
      .select({ ticker: 1 }).lean().catch(() => []),
    StocksAdviceRec.find({ generatedAt: { $gte: since }, action: "BUY" })
      .select({ ticker: 1 }).lean().catch(() => []),
  ]);
  const inDiscoverySet = new Set((discoveryTickers || []).map(d => baseOf(d.ticker)));
  const inRecSet = new Set((recTickers || []).map(r => baseOf(r.ticker)));
  const inEitherSet = new Set([...inDiscoverySet, ...inRecSet]);

  // 4b) Caught-early: BUY rec exists BEFORE the observation window
  //     (rec was made ahead of the winning week — not chasing).
  const catchWindowStart = new Date(Date.now() - (WEEK_TRADING_DAYS + CATCH_EARLY_LOOKBACK_DAYS) * 86400 * 1000);
  const catchWindowEnd = new Date(Date.now() - WEEK_TRADING_DAYS * 86400 * 1000);
  const catchRecs = await StocksAdviceRec.find({
    generatedAt: { $gte: catchWindowStart, $lte: catchWindowEnd },
    action: "BUY",
    ticker: { $in: winners.map(w => w.ticker.toUpperCase()) },
  }).select({ ticker: 1, generatedAt: 1, entryPrice: 1 }).lean().catch(() => []);
  const caughtEarlyMap = new Map();
  for (const r of catchRecs || []) {
    const b = baseOf(r.ticker);
    if (!caughtEarlyMap.has(b)) caughtEarlyMap.set(b, { recDate: r.generatedAt, recEntryPrice: r.entryPrice });
  }

  // 5) Attribute
  let inOurUniverse = 0, inOurDiscovery = 0, inEither = 0, caughtEarly = 0, missed = 0;
  const samples = [];
  for (const w of winners) {
    const b = baseOf(w.ticker);
    const inRec = inRecSet.has(b);
    const inDisc = inDiscoverySet.has(b);
    const inAny = inEitherSet.has(b);
    const caught = caughtEarlyMap.has(b);
    if (inRec || inDisc) inOurUniverse++;
    if (inDisc) inOurDiscovery++;
    if (inAny) inEither++;
    if (caught) caughtEarly++;
    if (!inAny) missed++;
    if (samples.length < SAMPLES_TO_STORE) {
      const source = caught ? "caught-early" : inDisc ? "in-discovery" : inAny ? "in-universe" : "missed";
      const s = { ticker: w.ticker, weeklyReturnPct: Math.round(w.weeklyReturnPct * 10) / 10, source };
      if (caught) {
        const ce = caughtEarlyMap.get(b);
        s.recDate = ce.recDate;
        s.recEntryPrice = ce.recEntryPrice;
      }
      samples.push(s);
    }
  }
  const coveragePct = winners.length > 0 ? (inEither / winners.length) * 100 : 0;
  const caughtEarlyPct = winners.length > 0 ? (caughtEarly / winners.length) * 100 : 0;

  const doc = {
    observedAt,
    asOfDate: asOf,
    universeSize: universe.length,
    topDecileCount: winners.length,
    inOurUniverse,
    inOurDiscovery,
    inEither,
    caughtEarly,
    missed,
    coveragePct: Math.round(coveragePct * 10) / 10,
    caughtEarlyPct: Math.round(caughtEarlyPct * 10) / 10,
    context: {
      sampleCap,
      sampledFromUniverse: sampled.length,
      measuredReturns: measured.length,
      lookbackDays: LOOKBACK_DAYS,
      catchEarlyLookbackDays: CATCH_EARLY_LOOKBACK_DAYS,
      topDecilePct: TOP_DECILE_PCT,
      elapsedMs: Date.now() - runStart,
    },
    samples,
    error: null,
  };

  // Upsert by asOfDate — one row per calendar day.
  const asOfDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  try {
    await StocksMissedWinnerCoverage.updateOne(
      { asOfDate: asOfDay },
      { $set: doc },
      { upsert: true }
    );
  } catch (e) {
    console.warn("[coverage-kpi] persist failed:", e?.message);
  }
  return doc;
}

// Failure snapshot — persists an error row so the operator can see
// that the KPI ran but couldn't compute today (vs "cron didn't fire").
async function persistFailure(observedAt, asOf, error) {
  const asOfDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const doc = { observedAt, asOfDate: asOfDay, error };
  try {
    await StocksMissedWinnerCoverage.updateOne(
      { asOfDate: asOfDay },
      { $set: doc },
      { upsert: true }
    );
  } catch { /* ignore */ }
  return doc;
}

function baseOf(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Read helper for API / diagnostics endpoint.
export async function getRecentCoverageKPIs({ limit = 30 } = {}) {
  try {
    return await StocksMissedWinnerCoverage.find({})
      .sort({ asOfDate: -1 }).limit(limit).lean();
  } catch { return []; }
}
