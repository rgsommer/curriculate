// backend/services/stocksFedLiquidity.js
//
// Fed liquidity + regime detector. Four free FRED series read the state of
// the plumbing that actually drives risk-asset direction more than any
// earnings print does:
//
//   RRPONTSYD  — Reverse Repo balance. Liquidity leaving system → risk-off.
//   WTREGEN    — Treasury General Account balance. Rising = liquidity
//                being absorbed → risk-off.
//   DGS10-DGS2 — 10y minus 2y Treasury (yield curve). Steepening after
//                inversion = recession clock ticking.
//   BAMLH0A0HYM2  — ICE BofA High-Yield Option-Adjusted Spread. Rising =
//                credit stress → risk-off.
//
// We don't need a FRED API key for CSV endpoints on fred.stlouisfed.org
// — they're public. Cached 12h so we don't refetch on every briefing.
//
// Emits { regime: "risk-on"|"neutral"|"risk-off", contributors: [...] }
// so the briefing can quote WHY the regime call was made.

const CACHE = { fetchedAt: 0, data: null };
const TTL_MS = 12 * 60 * 60 * 1000;

// FRED public CSV per series — undocumented but stable for years.
const FRED_CSV = (series) =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}`;

async function fetchFredSeries(series) {
  try {
    const r = await fetch(FRED_CSV(series), {
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Macro Reader)" },
    });
    if (!r.ok) return null;
    const txt = await r.text();
    // CSV header: "DATE,SERIES_ID" then "YYYY-MM-DD,value" lines. Missing
    // values come through as ".".
    const rows = txt.split(/\r?\n/).slice(1).filter(Boolean);
    const parsed = rows
      .map((row) => {
        const [date, val] = row.split(",");
        const n = parseFloat(val);
        return { date, value: Number.isFinite(n) ? n : null };
      })
      .filter((p) => p.value != null);
    return parsed;
  } catch { return null; }
}

// Compute delta over last N observations, ignoring nulls.
function pctDelta(series, n) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const last = series[series.length - 1];
  const then = series[series.length - 1 - Math.min(n, series.length - 1)];
  if (!last || !then || !then.value) return null;
  return ((last.value - then.value) / Math.abs(then.value)) * 100;
}

// Absolute change over last N (for spreads/curves already in %).
function absDelta(series, n) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const last = series[series.length - 1];
  const then = series[series.length - 1 - Math.min(n, series.length - 1)];
  if (!last || !then || last.value == null || then.value == null) return null;
  return last.value - then.value;
}

export async function getFedLiquidity() {
  const now = Date.now();
  if (CACHE.data && now - CACHE.fetchedAt < TTL_MS) return CACHE.data;

  const [rrp, tga, dgs10, dgs2, hySpread] = await Promise.all([
    fetchFredSeries("RRPONTSYD"),
    fetchFredSeries("WTREGEN"),
    fetchFredSeries("DGS10"),
    fetchFredSeries("DGS2"),
    fetchFredSeries("BAMLH0A0HYM2"),
  ]);

  // Yield curve = 10y - 2y (both in %)
  let curve = null;
  if (dgs10?.length && dgs2?.length) {
    const last10 = dgs10[dgs10.length - 1];
    const last2 = dgs2[dgs2.length - 1];
    if (last10?.value != null && last2?.value != null) {
      curve = { date: last10.date, value: last10.value - last2.value };
    }
  }

  const rrpLatest = rrp?.[rrp.length - 1]?.value ?? null;
  const rrpChange30d = pctDelta(rrp, 30);
  const tgaLatest = tga?.[tga.length - 1]?.value ?? null;
  const tgaChange30d = pctDelta(tga, 30);
  const hyLatest = hySpread?.[hySpread.length - 1]?.value ?? null;
  const hyChange30d = absDelta(hySpread, 30);

  // Regime scoring: each dimension contributes +/- to a running score.
  //   RRP falling >5% (30d) = liquidity draining → -1 (risk-off)
  //   TGA rising >20% (30d) = Fed absorbing liquidity → -1
  //   Curve steepening after inversion (i.e., moving toward positive) = -1
  //     (classic recession-clock signal — steepening AFTER inversion,
  //     not before)
  //   HY spread widening >50bp (30d) = credit stress → -1
  //   Opposite direction on each = +1 (risk-on)
  let score = 0;
  const contributors = [];
  if (rrpChange30d != null) {
    if (rrpChange30d < -5) { score -= 1; contributors.push(`RRP down ${rrpChange30d.toFixed(0)}% in 30d — liquidity draining from system`); }
    else if (rrpChange30d > 5) { score += 1; contributors.push(`RRP up ${rrpChange30d.toFixed(0)}% in 30d — liquidity accumulating`); }
  }
  if (tgaChange30d != null) {
    if (tgaChange30d > 20) { score -= 1; contributors.push(`TGA up ${tgaChange30d.toFixed(0)}% in 30d — Treasury absorbing liquidity`); }
    else if (tgaChange30d < -20) { score += 1; contributors.push(`TGA down ${tgaChange30d.toFixed(0)}% in 30d — Treasury releasing liquidity`); }
  }
  if (hyChange30d != null) {
    if (hyChange30d > 0.5) { score -= 1; contributors.push(`HY spread widened ${hyChange30d.toFixed(2)}pp in 30d — credit stress rising`); }
    else if (hyChange30d < -0.3) { score += 1; contributors.push(`HY spread tightened ${Math.abs(hyChange30d).toFixed(2)}pp in 30d — credit easing`); }
  }
  if (curve?.value != null) {
    // Only comment when inversion is present or fresh un-inversion. -0.5% or
    // deeper = inverted. A shift TOWARD zero from inversion = recession clock.
    if (curve.value < -0.5) contributors.push(`Yield curve inverted (2s10s ${curve.value.toFixed(2)}%) — recession watch`);
    else if (curve.value > 0 && curve.value < 0.5) contributors.push(`Curve just un-inverted (${curve.value.toFixed(2)}%) — historically recession follows within 12mo`);
  }

  const regime = score >= 1 ? "risk-on" : score <= -1 ? "risk-off" : "neutral";
  const data = {
    regime,
    score,
    contributors,
    rrpLatest,
    rrpChange30d,
    tgaLatest,
    tgaChange30d,
    hyLatest,
    hyChange30d,
    yieldCurve: curve,
    fetchedAt: new Date(),
  };
  CACHE.data = data;
  CACHE.fetchedAt = now;
  return data;
}

export function formatFedLiquidityBlock(fed) {
  if (!fed || !fed.regime) return "";
  const emoji = fed.regime === "risk-on" ? "🟢" : fed.regime === "risk-off" ? "🔴" : "⚪";
  const lines = [
    `\nFED LIQUIDITY REGIME: ${emoji} ${fed.regime.toUpperCase()} (score ${fed.score})`,
    ...fed.contributors.map((c) => `  · ${c}`),
    `  Tilt: risk-on = size positions FULL, take breakouts. risk-off = TRIM position size, tighten stops, avoid new speculative entries. neutral = business as usual. This regime signal beats any single-stock catalyst when it's decisive.`,
  ];
  return lines.join("\n");
}
