// backend/services/stocksEarningsSurprise.js
//
// P2.5 (2026-09-09) — earnings surprise + post-earnings drift.
// P2.6 (2026-09-09 later) — CORRECTNESS PATCH: proper release-timing
//                            alignment. Pre-market / after-market /
//                            during-market / unknown release timings
//                            produce DIFFERENT bar alignments so a
//                            pre-market release never uses the prior
//                            close as an already-post-event price.
//
// Alignment rules (see comment block on `alignReactionBars` below):
//
//   AFTER-MARKET (amc) release on day D:
//     preEventTradingDate  = D            (D's close is pre-release)
//     reactionTradingDate  = D+1          (first post-release open)
//     preEventClose        = D.close
//     reactionOpen         = (D+1).open
//     reactionDay1Close    = (D+1).close
//
//   PRE-MARKET (bmo) release on day D:
//     preEventTradingDate  = D−1          (prior close is pre-release)
//     reactionTradingDate  = D            (release day's open reacts)
//     preEventClose        = (D−1).close
//     reactionOpen         = D.open
//     reactionDay1Close    = D.close
//
//   DURING-MARKET or UNKNOWN release on day D:
//     CONSERVATIVE — treat as AFTER-MARKET so no pre-release price
//     is mistaken for a post-release reaction. Missing an intraday
//     reaction is safer than fabricating one that used pre-release
//     information as if it were post-release.
//
// Fail-open: any fetch failure → { ok: false, reason }. A missing
// baseline bar → row persists with driftClassification="INSUFFICIENT_DATA".

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
function ymd(d) { return String(d || "").slice(0, 10); }

// PUBLIC — normalize release timing from FMP's `time` field or other hints.
// Returns one of: "pre-market" | "after-market" | "during-market" | "unknown".
export function normalizeReleaseTiming(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "bmo" || s === "before" || s === "pre" || s.includes("before market") || s.includes("pre-market")) return "pre-market";
  if (s === "amc" || s === "after" || s === "post" || s.includes("after market") || s.includes("post-market")) return "after-market";
  if (s === "dmt" || s === "during" || s.includes("during market")) return "during-market";
  return "unknown";
}

// PUBLIC — align the trading bars around an earnings release using
// the release timing. Returns:
//   { preEventTradingDate, reactionTradingDate, preEventClose,
//     reactionOpen, reactionDay1Close, reactionDay3Close, reactionDay5Close,
//     benchReactionOpen, benchReactionDay1Close, benchReactionDay5Close,
//     day1Rvol, gapOpenPct, day1ReturnPct, day3ReturnPct, day5ReturnPct,
//     day1VsBenchmarkPct, day5VsBenchmarkPct, gapRetentionPct,
//     relativeVolume }
//
// Returns null when there aren't enough bars to score.
//
// bars / benchBars: Yahoo daily bars, sorted oldest→newest, each
// carrying at least { date, open, close, volume }.
export function alignReactionBars({ bars, benchBars = null, earningsDate, releaseTiming }) {
  if (!Array.isArray(bars) || bars.length === 0 || !earningsDate) return null;
  const eYmd = ymd(earningsDate);

  // Find the bar AT the earnings date and the immediately-adjacent bars.
  // idxAt = last index with date === eYmd; idxBefore = last index with
  // date < eYmd; idxAfter = first index with date > eYmd. If eYmd falls
  // on a non-trading day (holiday), idxAt is -1 and we still have
  // idxBefore + idxAfter to work with.
  let idxAt = -1, idxBefore = -1, idxAfter = -1;
  for (let i = 0; i < bars.length; i++) {
    const d = ymd(bars[i].date);
    if (d === eYmd) idxAt = i;
    if (d < eYmd) idxBefore = i;
    if (d > eYmd && idxAfter < 0) idxAfter = i;
  }
  // Resolve preEvent / reaction indices per timing branch.
  let preIdx, reactIdx;
  if (releaseTiming === "pre-market") {
    // Reaction day = release day itself (idxAt if present, else next bar).
    reactIdx = idxAt >= 0 ? idxAt : idxAfter;
    preIdx   = idxBefore;
  } else {
    // after-market / during-market / unknown → CONSERVATIVE: treat as
    // after-market so we never use a pre-release price as post-release.
    reactIdx = idxAfter;
    preIdx   = idxAt >= 0 ? idxAt : idxBefore;
  }
  if (preIdx < 0 || reactIdx < 0 || preIdx >= bars.length || reactIdx >= bars.length) return null;

  const preBar    = bars[preIdx];
  const reactBar  = bars[reactIdx];
  const react3    = bars[reactIdx + 2] || null; // day-3 relative to reaction (0/+1/+2/+3 = 4 bars)
  const react5    = bars[reactIdx + 4] || null;
  if (!preBar || !reactBar) return null;

  const preClose  = Number(preBar.close);
  const rOpen     = Number(reactBar.open);
  const rClose    = Number(reactBar.close);
  if (!Number.isFinite(preClose) || preClose <= 0 || !Number.isFinite(rOpen) || !Number.isFinite(rClose)) return null;

  const pct = (from, to) => (Number.isFinite(from) && from !== 0 && Number.isFinite(to)) ? ((to - from) / Math.abs(from)) * 100 : null;

  const gapOpenPct    = pct(preClose, rOpen);
  const day1ReturnPct = pct(preClose, rClose);
  const day3ReturnPct = react3 ? pct(preClose, Number(react3.close)) : null;
  const day5ReturnPct = react5 ? pct(preClose, Number(react5.close)) : null;

  // Benchmark alignment — mirror the same preIdx/reactIdx logic using
  // dates rather than positional indices. Falls back to indexing by
  // date so a benchmark trading calendar that differs from ticker
  // (rare on major exchanges) doesn't misalign.
  let day1VsBenchmarkPct = null, day5VsBenchmarkPct = null;
  if (Array.isArray(benchBars) && benchBars.length > 0) {
    const preD = ymd(preBar.date), reactD = ymd(reactBar.date);
    let bPre = -1, bReact = -1;
    for (let i = 0; i < benchBars.length; i++) {
      const d = ymd(benchBars[i].date);
      if (d === preD) bPre = i;
      if (d === reactD) bReact = i;
    }
    if (bPre >= 0 && bReact >= 0) {
      const bpc = Number(benchBars[bPre].close);
      const b1  = benchBars[bReact];
      const b5  = benchBars[bReact + 4] || null;
      const b1r = pct(bpc, Number(b1?.close));
      const b5r = b5 ? pct(bpc, Number(b5.close)) : null;
      if (Number.isFinite(day1ReturnPct) && Number.isFinite(b1r)) day1VsBenchmarkPct = day1ReturnPct - b1r;
      if (Number.isFinite(day5ReturnPct) && Number.isFinite(b5r))  day5VsBenchmarkPct = day5ReturnPct - b5r;
    }
  }

  // Relative volume — reaction-day volume vs 50-bar leading average.
  let relativeVolume = null;
  const vols = bars.slice(Math.max(0, reactIdx - 50), reactIdx).map(b => Number(b.volume)).filter(v => Number.isFinite(v) && v > 0);
  const reactVol = Number(reactBar.volume);
  if (vols.length >= 10 && Number.isFinite(reactVol)) {
    const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
    relativeVolume = reactVol / avg;
  }

  // Gap retention at day 5. Positive gap held if day-5 close still
  // retains ≥50% of the initial gap; negative-gap symmetric.
  let gapRetentionPct = null;
  let gapHeldAtDay5 = null;
  if (Number.isFinite(gapOpenPct) && Number.isFinite(day5ReturnPct)) {
    gapRetentionPct = gapOpenPct === 0 ? 0 : (day5ReturnPct / gapOpenPct) * 100;
    if (gapOpenPct > 0) gapHeldAtDay5 = day5ReturnPct >= gapOpenPct * 0.5;
    else if (gapOpenPct < 0) gapHeldAtDay5 = day5ReturnPct <= gapOpenPct * 0.5;
    else gapHeldAtDay5 = day5ReturnPct > 0;
  }

  return {
    preEventTradingDate: ymd(preBar.date),
    reactionTradingDate: ymd(reactBar.date),
    preEventClose: preClose,
    reactionOpen: rOpen,
    reactionDay1Close: rClose,
    reactionDay3Close: react3 ? Number(react3.close) : null,
    reactionDay5Close: react5 ? Number(react5.close) : null,
    gapOpenPct, day1ReturnPct, day3ReturnPct, day5ReturnPct,
    day1VsBenchmarkPct, day5VsBenchmarkPct,
    gapRetentionPct, gapHeldAtDay5,
    relativeVolume,
  };
}

// Score composition using the P2.6-aligned metrics. Same 0..100 scale
// as before, but every input is now temporally correct.
function composeDriftScore(reaction, surprise) {
  if (!reaction) return { driftClassification: "INSUFFICIENT_DATA" };
  let score = 50;
  if (Number.isFinite(reaction.day5ReturnPct))      score += Math.max(-25, Math.min(25, reaction.day5ReturnPct));
  if (Number.isFinite(reaction.day5VsBenchmarkPct)) score += Math.max(-15, Math.min(15, reaction.day5VsBenchmarkPct));
  if (reaction.gapHeldAtDay5 === true)              score += 10;
  if (reaction.gapHeldAtDay5 === false)             score -= 15;
  if (Number.isFinite(reaction.relativeVolume) && reaction.relativeVolume >= 1.5) score += 5;
  if (Number.isFinite(reaction.relativeVolume) && reaction.relativeVolume < 0.8)  score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const epsSurp = Number(surprise?.epsSurprisePct);
  let cls = "NEUTRAL";
  if (Number.isFinite(epsSurp) && epsSurp > 0) {
    cls = reaction.gapHeldAtDay5 === true && (reaction.day5VsBenchmarkPct == null || reaction.day5VsBenchmarkPct >= 0)
      ? "POSITIVE_ACCEPTANCE"
      : reaction.gapHeldAtDay5 === false || (Number.isFinite(reaction.day5VsBenchmarkPct) && reaction.day5VsBenchmarkPct < -2)
        ? "POSITIVE_FAILED"
        : "POSITIVE_MIXED";
  } else if (Number.isFinite(epsSurp) && epsSurp < 0) {
    cls = "NEGATIVE";
  }
  return { postEarningsDriftScore: score, driftClassification: cls };
}

function rollScore(recent, prior) {
  const a = Number(recent?.postEarningsDriftScore);
  const b = Number(prior?.postEarningsDriftScore);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.round(a * 0.7 + b * 0.3);
  if (Number.isFinite(a)) return Math.round(a);
  if (Number.isFinite(b)) return Math.round(b);
  return null;
}

// Fetch a per-ticker map of earningsDate → releaseTiming from FMP's
// historical earnings-calendar. One call per ticker per day (cached
// upstream by any caller if needed). Returns Map<ymd, timing-string>.
async function fetchReleaseTimingsForTicker(ticker) {
  const map = new Map();
  if (!isFmpEnabled()) return map;
  try {
    // The v3 historical endpoint is well-supported; some FMP tiers
    // also expose /stable/earnings-calendar?symbol=X — try both.
    const arr = await fmpGet(`/api/v3/historical/earning_calendar/${encodeURIComponent(ticker)}`).catch(() => null)
             || await fmpGet(`/stable/earnings-calendar?symbol=${encodeURIComponent(ticker)}`).catch(() => null);
    if (Array.isArray(arr)) {
      for (const row of arr) {
        const d = ymd(row.date);
        if (!d) continue;
        map.set(d, normalizeReleaseTiming(row.time));
      }
    }
  } catch { /* fall through */ }
  return map;
}

// PUBLIC — evaluate ticker's most-recent-earnings drift with proper
// release-timing alignment.
export async function getEarningsSurpriseAndDrift(ticker, { benchmarkTicker = "SPY" } = {}) {
  if (!isFmpEnabled()) return { ok: false, reason: fmpDisabledReason() || "fmp_disabled" };
  try {
    const [surprises, bars, benchBars, timingsMap] = await Promise.all([
      fmpGet(`/api/v3/earnings-surprises/${encodeURIComponent(ticker)}`).catch(() => null),
      fetchYahooDaily(ticker, "1y").catch(() => null),
      fetchYahooDaily(benchmarkTicker, "1y").catch(() => null),
      fetchReleaseTimingsForTicker(ticker),
    ]);
    if (!Array.isArray(surprises) || surprises.length === 0) {
      return { ok: false, reason: "no earnings-surprise data" };
    }
    const sorted = [...surprises].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const top = sorted.slice(0, 3).map(row => ({
      earningsDate: ymd(row.date),
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

    const evaluated = [];
    for (const r of top) {
      const releaseTiming = timingsMap.get(r.earningsDate) || normalizeReleaseTiming(r.rawSurprise?.time);
      const timingConfident = releaseTiming === "pre-market" || releaseTiming === "after-market";
      const reaction = alignReactionBars({
        bars, benchBars, earningsDate: r.earningsDate,
        releaseTiming: timingConfident ? releaseTiming : "unknown",
      });
      const drift = composeDriftScore(reaction, r);
      const merged = { ...r, releaseTiming, timingConfident, ...(reaction || {}), ...drift };
      evaluated.push(merged);
      try {
        await StocksEarningsSurpriseCache.updateOne(
          { ticker, earningsDate: r.earningsDate },
          { $set: {
            ticker, earningsDate: r.earningsDate,
            releaseTiming,
            timingConfident,
            preEventTradingDate: reaction?.preEventTradingDate ?? null,
            reactionTradingDate: reaction?.reactionTradingDate ?? null,
            preEventClose: reaction?.preEventClose ?? null,
            reactionOpen: reaction?.reactionOpen ?? null,
            reactionDay1Close: reaction?.reactionDay1Close ?? null,
            reactionDay3Close: reaction?.reactionDay3Close ?? null,
            reactionDay5Close: reaction?.reactionDay5Close ?? null,
            reportedEPS: r.reportedEPS, estimatedEPS: r.estimatedEPS,
            epsSurprisePct: r.epsSurprisePct,
            reportedRevenue: Number.isFinite(r.rawSurprise?.actualRevenue) ? r.rawSurprise.actualRevenue : null,
            estimatedRevenue: Number.isFinite(r.rawSurprise?.estimatedRevenue) ? r.rawSurprise.estimatedRevenue : null,
            revenueSurprisePct: (() => {
              const a = r.rawSurprise?.actualRevenue, e = r.rawSurprise?.estimatedRevenue;
              if (!Number.isFinite(a) || !Number.isFinite(e) || e === 0) return null;
              return ((a - e) / Math.abs(e)) * 100;
            })(),
            gapOpenPct: reaction?.gapOpenPct ?? null,
            day1ClosePct: reaction?.day1ReturnPct ?? null,   // legacy field name kept
            day3ClosePct: reaction?.day3ReturnPct ?? null,
            day5ClosePct: reaction?.day5ReturnPct ?? null,
            day1VsBenchPct: reaction?.day1VsBenchmarkPct ?? null,
            day5VsBenchPct: reaction?.day5VsBenchmarkPct ?? null,
            day1Rvol: reaction?.relativeVolume ?? null,
            gapRetentionPct: reaction?.gapRetentionPct ?? null,
            gapHeldAtDay5: reaction?.gapHeldAtDay5 ?? null,
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
