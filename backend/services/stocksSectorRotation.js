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

// ─────────────────────────────────────────────────────────────────────
// First-class sector helpers — leaders/laggards/hot/cold rankings +
// ticker→sector map that lets the validator and deterministic prefix
// consult sector RS directly instead of relying on AI prose.
//
// "Leader" = top 3 by 60d RS.
// "Laggard" = bottom 3 by 60d RS.
// "Hot" = leader that is ALSO in the top-half of 20d RS
//         (long-term strength + short-term momentum confirmation).
// "Cold" = laggard that is ALSO in the bottom-half of 20d RS.
// ─────────────────────────────────────────────────────────────────────

export function getSectorLeaders(rot, n = 3) {
  if (!rot?.rows?.length) return [];
  return rot.rows.slice(0, Math.min(n, rot.rows.length));
}

export function getSectorLaggards(rot, n = 3) {
  if (!rot?.rows?.length) return [];
  // rows are sorted by rs60d desc, so laggards are the tail (reversed
  // so index 0 is the worst).
  return rot.rows.slice(-Math.min(n, rot.rows.length)).slice().reverse();
}

export function getHotSectors(rot, n = 3) {
  const leaders = getSectorLeaders(rot, n);
  if (leaders.length === 0) return [];
  const total = rot.rows.length;
  const topHalfCutoff = Math.ceil(total / 2);
  return leaders.filter(r => (r.rank20d ?? total) <= topHalfCutoff);
}

export function getColdSectors(rot, n = 3) {
  const laggards = getSectorLaggards(rot, n);
  if (laggards.length === 0) return [];
  const total = rot.rows.length;
  const bottomHalfCutoff = Math.ceil(total / 2);
  return laggards.filter(r => (r.rank20d ?? 0) > total - bottomHalfCutoff);
}

// GICS-ish ticker → SPDR sector symbol. Covers held / commonly-recommended
// SWING and SPEC names. Unknown tickers return null and are exempted
// from sector-based rejections (missing map ≠ block).
//
// Update when a new ticker enters the discovery/pick universe. Keeping
// this local (vs. a full GICS API) keeps the map auditable and avoids
// mystery classifications; the trade-off is manual upkeep.
export const TICKER_SECTOR_MAP = {
  // ─── XLK Technology ───
  MSFT: "XLK", AAPL: "XLK", NVDA: "XLK", ORCL: "XLK", ADBE: "XLK",
  CSCO: "XLK", AVGO: "XLK", AMD: "XLK", CRM: "XLK", NOW: "XLK",
  INTU: "XLK", IBM: "XLK", QCOM: "XLK", TXN: "XLK", MU: "XLK",
  PANW: "XLK", CRWD: "XLK", SNPS: "XLK", CDNS: "XLK", MRVL: "XLK",
  SMCI: "XLK", ANET: "XLK",
  // Canadian tech (mapped to XLK for RS reference — TSX overlay is TBD)
  CSU: "XLK", OTEX: "XLK", GIB: "XLK",

  // ─── XLF Financials ───
  JPM: "XLF", BAC: "XLF", WFC: "XLF", GS: "XLF", MS: "XLF", C: "XLF",
  BLK: "XLF", SCHW: "XLF", V: "XLF", MA: "XLF", AXP: "XLF",
  // Canadian banks + insurers
  RY: "XLF", TD: "XLF", BMO: "XLF", BNS: "XLF", CM: "XLF", NA: "XLF",
  CWB: "XLF", MFC: "XLF", SLF: "XLF", IFC: "XLF", GWO: "XLF",
  BN: "XLF", BAM: "XLF",

  // ─── XLE Energy ───
  XOM: "XLE", CVX: "XLE", COP: "XLE", EOG: "XLE", SLB: "XLE",
  PSX: "XLE", MPC: "XLE", VLO: "XLE", OXY: "XLE",
  // Canadian energy majors
  ENB: "XLE", TRP: "XLE", CNQ: "XLE", SU: "XLE", CVE: "XLE",
  IMO: "XLE", TOU: "XLE", ARX: "XLE",

  // ─── XLV Health Care ───
  UNH: "XLV", JNJ: "XLV", LLY: "XLV", ABBV: "XLV", MRK: "XLV",
  PFE: "XLV", TMO: "XLV", ABT: "XLV", DHR: "XLV", ISRG: "XLV",
  MDT: "XLV", AMGN: "XLV", GILD: "XLV", CVS: "XLV",

  // ─── XLY Consumer Discretionary ───
  AMZN: "XLY", TSLA: "XLY", HD: "XLY", MCD: "XLY", NKE: "XLY",
  LOW: "XLY", SBUX: "XLY", TJX: "XLY", BKNG: "XLY", CMG: "XLY",
  F: "XLY", GM: "XLY",
  ATD: "XLY", MG: "XLY", CTC: "XLY", L: "XLY",

  // ─── XLP Consumer Staples ───
  WMT: "XLP", PG: "XLP", KO: "XLP", PEP: "XLP", COST: "XLP",
  MO: "XLP", PM: "XLP", MDLZ: "XLP", CL: "XLP",

  // ─── XLI Industrials ───
  BA: "XLI", CAT: "XLI", GE: "XLI", HON: "XLI", UPS: "XLI",
  UNP: "XLI", RTX: "XLI", LMT: "XLI", DE: "XLI", MMM: "XLI",
  ETN: "XLI", CSX: "XLI", NSC: "XLI",
  CP: "XLI", CNR: "XLI", WCN: "XLI",

  // ─── XLU Utilities ───
  NEE: "XLU", DUK: "XLU", SO: "XLU", D: "XLU", AEP: "XLU", XEL: "XLU",
  FTS: "XLU", H: "XLU", EMA: "XLU", AQN: "XLU", BCE: "XLU", T: "XLU",
  RCI: "XLU",

  // ─── XLB Materials ───
  LIN: "XLB", APD: "XLB", SHW: "XLB", ECL: "XLB", FCX: "XLB",
  NEM: "XLB", GOLD: "XLB", NUE: "XLB",

  // ─── XLRE Real Estate ───
  AMT: "XLRE", PLD: "XLRE", CCI: "XLRE", EQIX: "XLRE", O: "XLRE",
  SPG: "XLRE", PSA: "XLRE",
  REI: "XLRE", CAR: "XLRE",

  // ─── XLC Communication Services ───
  GOOGL: "XLC", GOOG: "XLC", META: "XLC", NFLX: "XLC", DIS: "XLC",
  T_US: "XLC", // note: T is Telus (CAD) in TSX namespace; T (US AT&T) uses different route
  VZ: "XLC", TMUS: "XLC", CMCSA: "XLC",

  // ─── Common SPEC / high-vol names ───
  DJT: "XLC", PLTR: "XLK", COIN: "XLF", MSTR: "XLF", HOOD: "XLF",
  RIVN: "XLY", LCID: "XLY", NIO: "XLY", XPEV: "XLY", LI: "XLY",
  BABA: "XLY", PDD: "XLY", RKLB: "XLI", IONQ: "XLK", BBAI: "XLK",
  SOUN: "XLK", ZETA: "XLK",
};

function baseTickerForSectorLookup(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Return the SPDR sector symbol (XLK, XLF, …) for a ticker, or null
// if the ticker isn't mapped. Callers should treat null as "unknown —
// don't gate on sector" rather than "no sector."
export function mapTickerToSector(ticker) {
  if (!ticker) return null;
  const base = baseTickerForSectorLookup(ticker);
  return TICKER_SECTOR_MAP[base] || null;
}

// One-line SECTOR TILT for the deterministic Daily Orders prefix.
// Compact by design — the full RS table lives in the Appendix.
export function formatSectorTiltLine(rot) {
  if (!rot?.rows?.length) return "";
  const leaders = getSectorLeaders(rot, 3);
  const laggards = getSectorLaggards(rot, 3);
  if (leaders.length === 0 && laggards.length === 0) return "";
  const leaderStr = leaders.map(r => r.symbol).join(" / ");
  const laggardStr = laggards.map(r => r.symbol).join(" / ");
  return `SECTOR TILT: Leaders ${leaderStr} · Laggards ${laggardStr} · New buys: prefer leaders; avoid laggards.`;
}
