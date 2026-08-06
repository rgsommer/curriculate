// backend/services/stocksSectorRotation.js
//
// Ranks the 11 SPDR sector ETFs by relative strength vs SPY over 20d + 60d.
// Top-quintile sectors historically outperform bottom-quintile by ~15%/yr,
// so knowing where money is rotating IN and OUT gives a persistent tilt.
//
// One Yahoo call per ETF (12 including SPY), all in parallel, cached 4h.
// Cost: near-zero. Value: shows up on every briefing as a tilt hint.

import { fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";
import StocksSectorRankingSnapshot from "../models/StocksSectorRankingSnapshot.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";

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

  // Lazy-write this week's ranking snapshot (one row per ET week, keyed
  // to Monday). Enables the week-over-week 🔄 Rotation line without a
  // dedicated cron. Fail-open — a hiccup here never blocks the briefing.
  upsertWeeklySnapshot(rows).catch((e) => {
    console.warn("[sector-snapshot] upsert warn:", e?.message);
  });

  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Week-over-week snapshot store — one Mongo doc per Monday-of-ET-week.
// Used by computeSectorTransitions to detect which sectors rotated IN or
// OUT of the leader / laggard cohorts.
// ─────────────────────────────────────────────────────────────────────

function mondayOfCurrentWeekEt() {
  // Compute the calendar date (ET) of the Monday that starts the current
  // ET week. Store the resulting Date as midnight-UTC of that date so the
  // unique index behaves predictably regardless of DST.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get("weekday"); // "Mon", "Tue", ...
  const y = parseInt(get("year"), 10);
  const m = parseInt(get("month"), 10);
  const d = parseInt(get("day"), 10);
  const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday];
  // Days to subtract to reach Monday (treat Sunday as belonging to the
  // prior ET week so a Sun snapshot compares to *last* Monday).
  const offset = dayIndex === 0 ? 6 : dayIndex - 1;
  const midnightUtc = Date.UTC(y, m - 1, d) - offset * 86400000;
  return new Date(midnightUtc);
}

function isTodayMondayEt() {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    });
    return fmt.format(new Date()) === "Mon";
  } catch { return false; }
}

async function upsertWeeklySnapshot(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const monday = mondayOfCurrentWeekEt();
  const ranking = rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    rank: r.rank60d ?? null,
    rel20d: r.rs20d ?? null,
    rel60d: r.rs60d ?? null,
  }));
  const isMon = isTodayMondayEt();
  if (isMon) {
    // On Monday: refresh this week's snapshot with today's ranking.
    await StocksSectorRankingSnapshot.updateOne(
      { snapshotDate: monday },
      { $set: { ranking } },
      { upsert: true }
    );
  } else {
    // Tue-Sun: only create if this week's snapshot doesn't yet exist.
    // Prevents overwriting Monday's snapshot with a mid-week ranking.
    await StocksSectorRankingSnapshot.updateOne(
      { snapshotDate: monday },
      { $setOnInsert: { snapshotDate: monday, ranking } },
      { upsert: true }
    );
  }
}

// Compare the current ranking against the most recent snapshot older
// than 6 days. Returns { enteredLeaders, leftLeaders, enteredLaggards,
// leftLaggards, promotions, demotions } or null when nothing to compare.
// Fail-open: DB error → returns null and the caller skips the line.
export async function computeSectorTransitions(currentRanking) {
  try {
    if (!Array.isArray(currentRanking) || currentRanking.length === 0) return null;
    const sixDaysAgo = new Date(Date.now() - 6 * 86400000);
    const prior = await StocksSectorRankingSnapshot.findOne({
      snapshotDate: { $lt: sixDaysAgo },
    }).sort({ snapshotDate: -1 }).lean();
    if (!prior?.ranking?.length) return null;

    const priorRank = new Map();
    for (const r of prior.ranking) priorRank.set(r.symbol, r.rank);

    const total = currentRanking.length;
    const isLeader = (rank) => rank != null && rank <= 3;
    const isLaggard = (rank) => rank != null && rank >= total - 2;

    const enteredLeaders = [];
    const leftLeaders = [];
    const enteredLaggards = [];
    const leftLaggards = [];
    const promotions = [];
    const demotions = [];

    for (const cur of currentRanking) {
      const sym = cur.symbol;
      const curR = cur.rank60d ?? cur.rank;
      const prevR = priorRank.get(sym);
      if (prevR == null || curR == null) continue;
      const wasLeader = isLeader(prevR);
      const nowLeader = isLeader(curR);
      const wasLaggard = isLaggard(prevR);
      const nowLaggard = isLaggard(curR);
      if (!wasLeader && nowLeader) enteredLeaders.push({ symbol: sym, from: prevR, to: curR });
      if (wasLeader && !nowLeader) leftLeaders.push({ symbol: sym, from: prevR, to: curR });
      if (!wasLaggard && nowLaggard) enteredLaggards.push({ symbol: sym, from: prevR, to: curR });
      if (wasLaggard && !nowLaggard) leftLaggards.push({ symbol: sym, from: prevR, to: curR });
      const delta = curR - prevR;
      if (Math.abs(delta) >= 2) {
        if (delta < 0) promotions.push({ symbol: sym, from: prevR, to: curR });
        else demotions.push({ symbol: sym, from: prevR, to: curR });
      }
    }
    return { enteredLeaders, leftLeaders, enteredLaggards, leftLaggards, promotions, demotions };
  } catch (e) {
    console.warn("[sector-transitions] compute warn:", e?.message);
    return null;
  }
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

// One-line week-over-week rotation callout for the deterministic prefix.
// Renders "🔄 Rotation: XLE joined leaders (was #7); XLK dropped to #5
// (was #2); XLU joined laggards." — includes only material moves
// (in/out of top-3 / bottom-3, or a rank change ≥ 2 slots). Returns ""
// when there are no transitions to report so the line silently omits.
export function formatSectorTransitionLine(rot, transitions) {
  if (!transitions) return "";
  const seen = new Set();
  const parts = [];
  for (const t of transitions.enteredLeaders || []) {
    parts.push(`${t.symbol} joined leaders (was #${t.from})`);
    seen.add(t.symbol);
  }
  for (const t of transitions.leftLeaders || []) {
    if (seen.has(t.symbol)) continue;
    parts.push(`${t.symbol} dropped to #${t.to} (was #${t.from})`);
    seen.add(t.symbol);
  }
  for (const t of transitions.enteredLaggards || []) {
    if (seen.has(t.symbol)) continue;
    parts.push(`${t.symbol} joined laggards`);
    seen.add(t.symbol);
  }
  for (const t of transitions.leftLaggards || []) {
    if (seen.has(t.symbol)) continue;
    parts.push(`${t.symbol} climbed out of laggards (was #${t.from})`);
    seen.add(t.symbol);
  }
  // Any remaining big movers not already surfaced via the leader/laggard
  // transitions above (e.g. a promotion inside the middle-of-pack).
  for (const t of transitions.promotions || []) {
    if (seen.has(t.symbol)) continue;
    parts.push(`${t.symbol} rose to #${t.to} (was #${t.from})`);
    seen.add(t.symbol);
  }
  for (const t of transitions.demotions || []) {
    if (seen.has(t.symbol)) continue;
    parts.push(`${t.symbol} fell to #${t.to} (was #${t.from})`);
    seen.add(t.symbol);
  }
  if (parts.length === 0) return "";
  return `🔄 Rotation: ${parts.join("; ")}.`;
}

// Small per-holding sector map for the AI prompt — used by the §A2
// "sector cooling" rotation flag directive. Only surfaces SWING and
// SPEC holdings (CORE/INCOME are diversified across sectors or picked
// for yield, not sector momentum). Skips tickers whose sector isn't in
// the SPDR map — the AI is told to reason without them.
//
// Returns "" when there are no relevant holdings so the block silently
// omits from the prompt.
function baseTickerForMap(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

export function formatPerHoldingSectorMap(positions, rotation) {
  if (!Array.isArray(positions) || positions.length === 0) return "";
  if (!rotation?.rows?.length) return "";
  const total = rotation.rows.length;
  const sectorBySym = new Map();
  for (const r of rotation.rows) sectorBySym.set(r.symbol, r);

  const seen = new Set();
  const lines = [];
  for (const p of positions) {
    let sleeve;
    try { sleeve = classifyPosition(p); } catch { sleeve = null; }
    if (sleeve !== "swing" && sleeve !== "spec") continue;
    const base = baseTickerForMap(p.ticker);
    if (!base || seen.has(base)) continue;
    const sectorSym = mapTickerToSector(p.ticker);
    if (!sectorSym) continue;
    const sector = sectorBySym.get(sectorSym);
    if (!sector) continue;
    seen.add(base);
    const rank = sector.rank60d;
    let status = "NEUTRAL";
    let mark = "";
    if (rank != null && rank <= 3) status = "LEADER";
    else if (rank != null && rank >= total - 2) { status = "LAGGARD"; mark = " ⚠"; }
    lines.push(`- ${base} → ${sector.name} (currently ${status} rank #${rank ?? "?"}${mark})`);
  }
  if (lines.length === 0) return "";
  return `\nPER-HOLDING SECTOR MAP (for §A2 rotation flag decisions):\n${lines.join("\n")}\n`;
}
