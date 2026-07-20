// backend/services/stocksSleeveEnforcer.js
//
// Automated portfolio-sleeve classifier + balance enforcer. Based on the
// 80/15/5 core/swing/spec structure the trader adopted after their
// journal analysis. The briefing consults this every morning so the
// mental load of "am I over-allocated to spec?" or "am I straying from
// my proven Canadian large-cap edge?" is zero — the tool answers before
// the trader asks.
//
// Classification rules (heuristic, deterministic, overridable via a
// future PositionSchema.sleeve field if needed):
//
//   CORE (80% target) — broad-market ETFs, long-duration bonds. Never
//     traded on discretion. This is the buy-and-hold anchor.
//
//   SWING (15% target) — Canadian TSX large-cap banks / insurers /
//     energy / utilities. This is the trader's proven 7-for-7 template.
//     Held 45-60 days per position, -8% hard stop, sized deliberately.
//
//   SPEC (5% target, cap) — high-volatility US names, meme/momentum
//     tickers, anything not in the other buckets. All prior losses
//     came from here (DJT: -$3,128). Cap enforced strictly.
//
// The classifier prefers explicit lists over vol thresholds so it's
// predictable — the trader always knows why a ticker got tagged.

const CORE_ETFS = new Set([
  // US broad-market
  "SPY", "VOO", "IVV", "VTI", "ITOT", "SPTM",
  // US NASDAQ-tilt
  "QQQ", "VUG", "SCHG",
  // US small-cap broad
  "IWM", "VB",
  // Canadian broad-market (TSX)
  "XIU", "XIC", "VCN", "XEQT", "XGRO", "XBAL", "VBAL", "VGRO", "VEQT",
  // Canadian S&P 500 wrappers
  "VFV", "XUS", "VUN", "XUU",
  // Bonds
  "AGG", "BND", "XBB", "VAB", "ZAG", "TLT", "IEF",
]);

const SWING_TICKERS = new Set([
  // Canadian banks
  "RY", "TD", "BMO", "BNS", "CM", "NA", "CWB",
  // Canadian insurers
  "MFC", "SLF", "IFC", "GWO",
  // Canadian energy majors
  "ENB", "TRP", "CNQ", "SU", "CVE", "IMO", "TOU", "ARX",
  // Canadian utilities / telecom / rails
  "FTS", "H", "EMA", "AQN", "BCE", "T", "RCI", "CP", "CNR",
  // Canadian consumer / industrial blue chips
  "L", "ATD", "MG", "CTC", "WCN", "GIB",
  // Canadian real estate + BAM
  "BN", "BAM", "REI", "CAR",
  // Canadian tech blue chips (mature)
  "CSU", "OTEX",
]);

const SPEC_TICKERS = new Set([
  // Known high-vol / meme / catalyst names — user's documented loss zone
  "DJT", "DJTWW", "GME", "AMC", "BBAI", "SOUN", "RIVN", "LCID",
  "PLTR", "RKLB", "IONQ", "SMCI", "COIN", "MSTR", "HOOD",
  "NIO", "XPEV", "LI", "BABA", "PDD",
]);

const DEFAULT_TARGETS = { core: 80, swing: 15, spec: 5 };
const SLEEVE_DRIFT_ALERT_PP = 5; // flag if actual > target ± 5 pp

// Normalize targets to sum to 100 exactly — user-edited values in
// Settings may not sum cleanly (e.g. 80 / 12 / 5 = 97). Anything
// missing/negative falls back to the default.
function normalizeTargets(t) {
  const raw = {
    core: Number.isFinite(+t?.core) && +t.core >= 0 ? +t.core : DEFAULT_TARGETS.core,
    swing: Number.isFinite(+t?.swing) && +t.swing >= 0 ? +t.swing : DEFAULT_TARGETS.swing,
    spec: Number.isFinite(+t?.spec) && +t.spec >= 0 ? +t.spec : DEFAULT_TARGETS.spec,
  };
  const sum = raw.core + raw.swing + raw.spec;
  if (sum <= 0) return { ...DEFAULT_TARGETS };
  return {
    core: (raw.core / sum) * 100,
    swing: (raw.swing / sum) * 100,
    spec: (raw.spec / sum) * 100,
  };
}

// Base ticker with exchange suffix stripped for lookup.
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "");
}

// Assign a sleeve to a position. Returns "core" | "swing" | "spec".
export function classifyPosition(position) {
  if (!position) return "spec";
  const base = baseTicker(position.ticker);
  if (CORE_ETFS.has(base)) return "core";
  if (SWING_TICKERS.has(base)) return "swing";
  if (SPEC_TICKERS.has(base)) return "spec";
  // Fallback: any TSX-suffixed ticker not on the spec list defaults to
  // SWING (aligns with the "Canadian book has been the edge" finding).
  // Everything else — unknown US names — defaults to SPEC because that's
  // where the trader's blow-ups have come from.
  if (/\.(TO|V|NE|CN)$/i.test(position.ticker || "")) return "swing";
  return "spec";
}

// Compute per-sleeve $ CAD totals + % of book + target deviation.
// targets: optional { core, swing, spec } override (from user's
// profile.sleeveTargets). Falls back to 80/15/5 default.
export function computeSleeveBalance(positions, fxUsdCad = 1.37, targets = null) {
  const targetPct = normalizeTargets(targets);
  const totals = { core: 0, swing: 0, spec: 0 };
  const byPosition = [];
  for (const p of positions || []) {
    const sleeve = classifyPosition(p);
    // Position CAD value: prefer priceCad if present (matches Dashboard math),
    // else convert priceUsd × fx.
    const cad = (Number.isFinite(p.priceCad) ? p.priceCad : (Number.isFinite(p.priceUsd) ? p.priceUsd * fxUsdCad : 0)) * (p.qty || 0);
    totals[sleeve] += cad;
    byPosition.push({
      ticker: p.ticker,
      sleeve,
      cadValue: cad,
    });
  }
  const bookTotal = totals.core + totals.swing + totals.spec;
  if (bookTotal === 0) return { totals, byPosition, book: 0, sleeves: {} };
  const actualPct = {
    core: (totals.core / bookTotal) * 100,
    swing: (totals.swing / bookTotal) * 100,
    spec: (totals.spec / bookTotal) * 100,
  };
  const deviations = {
    core: actualPct.core - targetPct.core,
    swing: actualPct.swing - targetPct.swing,
    spec: actualPct.spec - targetPct.spec,
  };
  const targetsCad = {
    core: bookTotal * targetPct.core / 100,
    swing: bookTotal * targetPct.swing / 100,
    spec: bookTotal * targetPct.spec / 100,
  };
  const rebalanceCad = {
    core: targetsCad.core - totals.core,
    swing: targetsCad.swing - totals.swing,
    spec: targetsCad.spec - totals.spec,
  };
  return {
    book: bookTotal,
    totals,
    actualPct,
    targets: targetPct,
    targetsPct: targetPct,
    deviations,
    targetsCad,
    rebalanceCad,
    byPosition,
    // Flags for the briefing to enforce
    specOverLimit: actualPct.spec > targetPct.spec,
    coreUnderweight: deviations.core < -SLEEVE_DRIFT_ALERT_PP,
    swingUnderweight: deviations.swing < -SLEEVE_DRIFT_ALERT_PP,
    driftAlertPp: SLEEVE_DRIFT_ALERT_PP,
  };
}

export function formatSleeveBalanceBlock(bal) {
  if (!bal || !bal.book) return "";
  const m = (v) => `$${Math.round(v).toLocaleString()} CAD`;
  const pct = (v) => `${v.toFixed(1)}%`;
  const dev = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp`;
  const lines = [
    `\nSLEEVE BALANCE (80/15/5 rule — auto-classified):`,
    `  Book total: ${m(bal.book)}`,
    `  CORE (buy-and-hold, target 80%): ${m(bal.totals.core)} · ${pct(bal.actualPct.core)} · ${dev(bal.deviations.core)}`,
    `  SWING (Canadian large-caps, target 15%): ${m(bal.totals.swing)} · ${pct(bal.actualPct.swing)} · ${dev(bal.deviations.swing)}`,
    `  SPEC (high-vol, target 5% CAP): ${m(bal.totals.spec)} · ${pct(bal.actualPct.spec)} · ${dev(bal.deviations.spec)}`,
  ];
  if (bal.specOverLimit) {
    const excessCad = bal.totals.spec - bal.targetsCad.spec;
    lines.push(`  🚨 SPEC OVER LIMIT: ${m(excessCad)} excess. NO NEW SPEC POSITIONS today. Trim the largest spec name or wait for the sleeve to shrink back to 5% before proposing any new high-vol names.`);
  }
  if (bal.coreUnderweight) {
    lines.push(`  ⚠ CORE UNDERWEIGHT (${dev(bal.deviations.core)}): consider adding to broad ETFs (XIC, VUN, XEQT) to restore anchor.`);
  }
  if (bal.swingUnderweight) {
    lines.push(`  💡 SWING SLEEVE HAS ROOM: ${m(-bal.rebalanceCad.swing).replace("-", "")} available for a new Canadian large-cap swing entry. Prefer the RY/ENB template if a fresh setup appears.`);
  }
  lines.push(`  Auto-classification: CORE = broad ETFs + bonds · SWING = Canadian large-caps · SPEC = high-vol US + meme. TSX names default to SWING; unknown US names default to SPEC (where prior losses came from).`);
  return lines.join("\n");
}
