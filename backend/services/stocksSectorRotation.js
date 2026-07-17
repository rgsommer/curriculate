// backend/services/stocksSectorRotation.js
//
// Ranks the 11 SPDR sector ETFs by relative strength vs SPY over 20d + 60d.
// Top-quintile sectors historically outperform bottom-quintile by ~15%/yr,
// so knowing where money is rotating IN and OUT gives a persistent tilt.
//
// One Yahoo call per ETF (12 including SPY), all in parallel, cached 4h.
// Cost: near-zero. Value: shows up on every briefing as a tilt hint.

import { fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";

const SECTOR_ETFS = [
  { symbol: "XLK",  name: "Technology" },
  { symbol: "XLF",  name: "Financials" },
  { symbol: "XLE",  name: "Energy" },
  { symbol: "XLV",  name: "Health Care" },
  { symbol: "XLY",  name: "Consumer Discretionary" },
  { symbol: "XLP",  name: "Consumer Staples" },
  { symbol: "XLI",  name: "Industrials" },
  { symbol: "XLU",  name: "Utilities" },
  { symbol: "XLB",  name: "Materials" },
  { symbol: "XLRE", name: "Real Estate" },
  { symbol: "XLC",  name: "Communication Services" },
];

const CACHE = { fetchedAt: 0, data: null };
const TTL_MS = 4 * 60 * 60 * 1000;

function returnPct(points, days) {
  if (!Array.isArray(points) || points.length < days + 1) return null;
  const now = points[points.length - 1];
  const then = points[points.length - 1 - days];
  if (!now?.close || !then?.close) return null;
  return ((now.close - then.close) / then.close) * 100;
}

export async function getSectorRotation() {
  const now = Date.now();
  if (CACHE.data && now - CACHE.fetchedAt < TTL_MS) return CACHE.data;

  const symbols = ["SPY", ...SECTOR_ETFS.map((s) => s.symbol)];
  const priceMap = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const { points } = await fetchDailyOhlcForBacktest(sym, "USD", 200);
      priceMap[sym] = points;
    } catch { priceMap[sym] = null; }
  }));

  const spyPoints = priceMap["SPY"];
  const spy20 = returnPct(spyPoints, 20);
  const spy60 = returnPct(spyPoints, 60);
  const spyYtd = (function () {
    if (!Array.isArray(spyPoints) || spyPoints.length === 0) return null;
    const ytdAnchor = new Date(new Date().getUTCFullYear(), 0, 1).getTime() / 1000;
    const startBar = spyPoints.find((p) => p.t >= ytdAnchor) || spyPoints[0];
    const endBar = spyPoints[spyPoints.length - 1];
    if (!startBar?.close || !endBar?.close) return null;
    return ((endBar.close - startBar.close) / startBar.close) * 100;
  })();

  const rows = SECTOR_ETFS.map((s) => {
    const pts = priceMap[s.symbol];
    const r20 = returnPct(pts, 20);
    const r60 = returnPct(pts, 60);
    const rYtd = (function () {
      if (!Array.isArray(pts) || pts.length === 0) return null;
      const ytdAnchor = new Date(new Date().getUTCFullYear(), 0, 1).getTime() / 1000;
      const startBar = pts.find((p) => p.t >= ytdAnchor) || pts[0];
      const endBar = pts[pts.length - 1];
      if (!startBar?.close || !endBar?.close) return null;
      return ((endBar.close - startBar.close) / startBar.close) * 100;
    })();
    const rs20 = r20 != null && spy20 != null ? r20 - spy20 : null;
    const rs60 = r60 != null && spy60 != null ? r60 - spy60 : null;
    return {
      symbol: s.symbol, name: s.name,
      return20d: r20, return60d: r60, returnYtd: rYtd,
      rs20d: rs20, rs60d: rs60,
    };
  });

  // Rank by 60d RS (most durable signal); 20d used as momentum overlay
  rows.sort((a, b) => (b.rs60d ?? -Infinity) - (a.rs60d ?? -Infinity));
  rows.forEach((r, i) => { r.rank60d = i + 1; });

  const rankedBy20d = [...rows].sort((a, b) => (b.rs20d ?? -Infinity) - (a.rs20d ?? -Infinity));
  rankedBy20d.forEach((r, i) => { r.rank20d = i + 1; });

  const data = {
    rows,
    spy: { return20d: spy20, return60d: spy60, returnYtd: spyYtd },
    fetchedAt: new Date(),
  };
  CACHE.data = data;
  CACHE.fetchedAt = now;
  return data;
}

export function formatSectorRotationBlock(rot) {
  if (!rot?.rows) return "";
  const top3 = rot.rows.slice(0, 3);
  const bot3 = rot.rows.slice(-3).reverse();
  const lines = [
    `\nSECTOR ROTATION (RS vs SPY over 60d):`,
    `  TOP: ${top3.map((r) => `${r.symbol} ${r.name} (60d RS ${r.rs60d >= 0 ? "+" : ""}${r.rs60d?.toFixed(1)}pp, 20d RS ${r.rs20d >= 0 ? "+" : ""}${r.rs20d?.toFixed(1)}pp)`).join(" · ")}`,
    `  BOTTOM: ${bot3.map((r) => `${r.symbol} ${r.name} (60d RS ${r.rs60d?.toFixed(1)}pp)`).join(" · ")}`,
    `  Tilt picks and new positions TOWARD the top-3 sectors, AWAY from the bottom-3. Historically the top quintile outperforms the bottom quintile by ~15%/yr.`,
  ];
  return lines.join("\n");
}
