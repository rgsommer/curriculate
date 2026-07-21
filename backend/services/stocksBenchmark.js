// backend/services/stocksBenchmark.js
//
// Portfolio-vs-benchmark comparison. Answers "am I actually beating the
// boring option?" The USD sleeve is compared to SPY; the CAD sleeve is
// compared to XIC.TO (iShares S&P/TSX 60). Combined benchmark is a
// FX-weighted blend of the two using the user's own USD/CAD split at
// each snapshot's date.
//
// Uses Yahoo daily bars (free) — no key, no rate limits at this cadence.
// Cached module-level for 4h since benchmarks don't move on the minute.

import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const cache = new Map(); // key: `${symbol}|${range}` → { fetchedAt, points }

async function fetchWithCache(symbol, range = "1y") {
  const key = `${symbol}|${range}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.points;
  const points = await fetchYahooDaily(symbol, range);
  if (points) cache.set(key, { fetchedAt: now, points });
  return points;
}

// Convert Yahoo's [{t, close}, ...] to a Map(YYYY-MM-DD → close).
function toDailyMap(points) {
  const m = new Map();
  for (const p of points || []) {
    const ymd = new Date(p.t * 1000).toISOString().slice(0, 10);
    m.set(ymd, p.close);
  }
  return m;
}

// Compound return over [startYmd, endYmd] using the closest daily bar
// at-or-before each date. Returns pct or null.
function benchmarkReturnPct(dailyMap, startYmd, endYmd) {
  const findAtOrBefore = (target) => {
    let best = null;
    for (const [ymd, close] of dailyMap) {
      if (ymd <= target && (!best || ymd > best[0])) best = [ymd, close];
    }
    return best;
  };
  const a = findAtOrBefore(startYmd);
  const b = findAtOrBefore(endYmd);
  if (!a || !b || !a[1] || !b[1]) return null;
  return ((b[1] - a[1]) / a[1]) * 100;
}

// Fetch SPY + XIC.TO daily bars and return their maps.
async function loadBenchmarks(range = "1y") {
  const [spy, xic] = await Promise.all([
    fetchWithCache("SPY", range).catch(() => null),
    fetchWithCache("XIC.TO", range).catch(() => null),
  ]);
  return {
    spy: spy ? toDailyMap(spy) : null,
    xic: xic ? toDailyMap(xic) : null,
  };
}

// Compute benchmark returns over three windows (WoW / YTD / since start
// of tracking). Falls back to null when the daily map doesn't span the
// requested window.
export async function computeBenchmarkReturns({ oldestSnapshotDate, latestSnapshotDate }) {
  if (!oldestSnapshotDate || !latestSnapshotDate) return null;
  // Pick the coarsest range that covers the "since start" window.
  const daysSpan = Math.floor(
    (new Date(latestSnapshotDate) - new Date(oldestSnapshotDate)) / 86400000
  );
  const range = daysSpan > 365 ? "5y" : (daysSpan > 90 ? "1y" : "6mo");

  const { spy, xic } = await loadBenchmarks(range);
  if (!spy && !xic) return null;

  const now = new Date();
  const wowStart = new Date(now); wowStart.setDate(wowStart.getDate() - 7);
  const wowYmd = wowStart.toISOString().slice(0, 10);
  const ytdYmd = `${now.getUTCFullYear()}-01-01`;
  const endYmd = latestSnapshotDate;

  const compute = (map) => ({
    wowPct: map ? benchmarkReturnPct(map, wowYmd, endYmd) : null,
    ytdPct: map ? benchmarkReturnPct(map, ytdYmd, endYmd) : null,
    sinceStartPct: map ? benchmarkReturnPct(map, oldestSnapshotDate, endYmd) : null,
  });

  return {
    spy: compute(spy),
    xic: compute(xic),
    range,
  };
}

// Format a compact BENCHMARK block for the briefing prompt. Only emits
// when we have at least one comparable window; skips otherwise.
export function formatBenchmarkBlock(userTwrr, benchmarks) {
  if (!benchmarks || !userTwrr) return "";
  const sp = benchmarks.spy || {};
  const xi = benchmarks.xic || {};
  const rows = [];
  const cmp = (label, uPct, spPct, xiPct) => {
    if (uPct == null && spPct == null && xiPct == null) return null;
    const fmt = (v) => v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
    const alpha = (bench) => (uPct != null && bench != null)
      ? `alpha ${uPct - bench >= 0 ? "+" : ""}${(uPct - bench).toFixed(2)}pp`
      : "";
    return `  ${label}: portfolio TWRR ${fmt(uPct)} · SPY ${fmt(spPct)} (${alpha(spPct)}) · XIC ${fmt(xiPct)} (${alpha(xiPct)})`;
  };
  const wow = cmp("WoW (7d)", userTwrr.wowPct, sp.wowPct, xi.wowPct);
  const ytd = cmp("YTD", userTwrr.ytdPct, sp.ytdPct, xi.ytdPct);
  const ss = cmp("Since start", userTwrr.sinceStartPct, sp.sinceStartPct, xi.sinceStartPct);
  for (const r of [wow, ytd, ss]) if (r) rows.push(r);
  if (rows.length === 0) return "";
  return [
    `\nPORTFOLIO vs BENCHMARK (deposit/withdrawal-adjusted; SPY = US sleeve proxy, XIC = Canadian sleeve proxy):`,
    ...rows,
    `\nHow to use:`,
    `  - Positive alpha in a window = you beat the passive alternative there. Cite the specific alpha figure when calling any high-conviction trade.`,
    `  - Negative alpha over YTD or since-start is a signal to reduce trade frequency and lean harder on the CORE sleeve (broad ETFs). Say so explicitly if it applies.`,
    `  - Alpha is more meaningful when both TWRR and benchmark are computed over the same window — which they are here.`,
  ].join("\n");
}
