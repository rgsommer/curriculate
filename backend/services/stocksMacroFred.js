// backend/services/stocksMacroFred.js
//
// Deterministic macro regime dashboard powered by the Federal Reserve
// Economic Data (FRED) API. Replaces the AI's guesswork about macro
// state with real numbers for the daily briefing.
//
// Complements — does not replace — services/stocksMacroContext.js
// (Yahoo-based, keeps working with no API key). This service is
// gated behind FRED_API_KEY + FRED_DISABLED kill-switch; when off,
// getMacroFred() returns { ok: false, reason }, and
// formatMacroFredBlock() returns "" so the AI prompt silently omits
// the block.
//
// Free registration: https://fredaccount.stlouisfed.org/apikeys
// Cache: 6h TTL — macro moves slowly and re-runs are cheap.

import { isFredEnabled, fredDisabledReason } from "./fredEnabled.js";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const CACHE = { fetchedAt: 0, data: null };
const TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

// FRED series we track. Each hits observations endpoint with limit=30
// so we get enough history to compute a 30-day delta AND fall back on
// the most recent non-null value for series that only publish weekly
// or monthly (a daily fetch for MORTGAGE30US, FEDFUNDS returns the same
// value most days — the deltas are meaningful, the daily bar isn't).
const SERIES = [
  { id: "DGS10", label: "10Y yield", unit: "%", scale: 1 },
  { id: "DGS2", label: "2Y yield", unit: "%", scale: 1 },
  { id: "T10Y2Y", label: "2s10s spread", unit: "%", scale: 1 },
  { id: "DFII10", label: "10Y real yield", unit: "%", scale: 1 },
  { id: "T10YIE", label: "10Y breakeven", unit: "%", scale: 1 },
  { id: "BAMLH0A0HYM2EY", label: "HY OAS yield", unit: "%", scale: 1 },
  { id: "BAMLC0A0CMEY", label: "IG OAS yield", unit: "%", scale: 1 },
  { id: "VIXCLS", label: "VIX", unit: "", scale: 1 },
  { id: "DTWEXBGS", label: "USD broad index", unit: "", scale: 1 },
  { id: "DEXCAUS", label: "CAD/USD", unit: "", scale: 1 },
  { id: "WTISPLC", label: "WTI oil", unit: "USD/bbl", scale: 1 },
  { id: "FEDFUNDS", label: "Fed funds rate", unit: "%", scale: 1 },
  { id: "MORTGAGE30US", label: "30Y mortgage", unit: "%", scale: 1 },
];

async function fredFetch(seriesId, limit = 30) {
  const key = (process.env.FRED_API_KEY || "").trim();
  const url = `${FRED_BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 429) return { ok: false, reason: "http_429" };
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const j = await r.json();
    const obs = j?.observations || [];
    // FRED returns "." for missing values; keep only real numeric readings.
    const points = obs
      .map(o => ({ date: o.date, value: Number.parseFloat(o.value) }))
      .filter(p => Number.isFinite(p.value));
    return { ok: true, points };
  } catch (e) {
    return { ok: false, reason: e?.message || "fetch_failed" };
  } finally {
    clearTimeout(tid);
  }
}

// Delta between latest value and value ~N business days back. FRED order
// is desc, so points[0] is most recent, points[N] is N obs back. Not
// strictly calendar days — for weekly/monthly series the delta is more
// like N observations, which is what actually matters for regime shifts.
function delta(points, back = 20) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const latest = points[0].value;
  const then = points[Math.min(back, points.length - 1)]?.value;
  if (!Number.isFinite(latest) || !Number.isFinite(then)) return null;
  return latest - then;
}

// Regime classifier — mirrors the labels in the spec Part 2.
function classifyRegime(snap) {
  const vix = snap.VIXCLS?.latest;
  const hyOas = snap.BAMLH0A0HYM2EY?.latest;
  const igOas = snap.BAMLC0A0CMEY?.latest;
  const spread2s10s = snap.T10Y2Y?.latest;
  const realYield = snap.DFII10?.latest;
  const realYield30dDelta = snap.DFII10?.delta30;
  const hyIgSpread = (Number.isFinite(hyOas) && Number.isFinite(igOas))
    ? (hyOas - igOas) * 100 // convert to bps
    : null;

  // Risk-off gates (any true)
  if (
    (Number.isFinite(vix) && vix > 25) ||
    (Number.isFinite(hyIgSpread) && hyIgSpread > 500) ||
    (Number.isFinite(spread2s10s) && spread2s10s < -0.5)
  ) {
    return "RISK-OFF";
  }
  // Risk-on (all true)
  if (
    Number.isFinite(vix) && vix < 15 &&
    Number.isFinite(hyIgSpread) && hyIgSpread < 300 &&
    Number.isFinite(spread2s10s) && spread2s10s > 0 &&
    Number.isFinite(realYield30dDelta) && realYield30dDelta < 0
  ) {
    return "RISK-ON";
  }
  // Growth-favoring
  if (
    Number.isFinite(realYield30dDelta) && realYield30dDelta < 0 &&
    Number.isFinite(snap.T10Y2Y?.delta30) && snap.T10Y2Y.delta30 > 0
  ) {
    return "GROWTH-FAVORING";
  }
  // Value-favoring
  const wtiDelta = snap.WTISPLC?.delta30;
  if (
    Number.isFinite(realYield30dDelta) && realYield30dDelta > 0 &&
    Number.isFinite(wtiDelta) && wtiDelta > 0
  ) {
    return "VALUE-FAVORING";
  }
  return "NEUTRAL";
}

export async function getMacroFred() {
  if (!isFredEnabled()) {
    return { ok: false, reason: fredDisabledReason() || "fred_disabled" };
  }
  const now = Date.now();
  if (CACHE.data && now - CACHE.fetchedAt < TTL_MS) return CACHE.data;

  const results = await Promise.all(SERIES.map(async s => {
    const r = await fredFetch(s.id, 40);
    return { id: s.id, label: s.label, unit: s.unit, ...r };
  }));

  const snap = {};
  let anyOk = false;
  for (const r of results) {
    if (r.ok && r.points?.length) {
      anyOk = true;
      snap[r.id] = {
        label: r.label,
        unit: r.unit,
        latest: r.points[0].value,
        latestDate: r.points[0].date,
        delta5: delta(r.points, 5),
        delta30: delta(r.points, 20), // ~20 business days ≈ 30 calendar
      };
    } else {
      snap[r.id] = { label: r.label, unit: r.unit, latest: null, error: r.reason || "no data" };
    }
  }
  if (!anyOk) {
    const data = { ok: false, reason: "all_series_failed" };
    CACHE.data = data; CACHE.fetchedAt = now;
    return data;
  }

  const regime = classifyRegime(snap);
  const data = {
    ok: true,
    regime,
    snap,
    fetchedAt: new Date(now).toISOString(),
    asOf: snap.DGS10?.latestDate || snap.VIXCLS?.latestDate || null,
  };
  CACHE.data = data;
  CACHE.fetchedAt = now;
  return data;
}

// Helpers for the block formatter
function fmtPct(v, digits = 2) {
  return Number.isFinite(v) ? `${v.toFixed(digits)}%` : "n/a";
}
function fmtNum(v, digits = 2) {
  return Number.isFinite(v) ? v.toFixed(digits) : "n/a";
}
// Accepts a value already in basis points (i.e. percentage points × 100)
// — matches the callers below that pre-multiply the pct-point difference.
function bps(v) {
  return Number.isFinite(v) ? `${Math.round(v)}bps` : "n/a";
}
function trendTag(d, unit = "%") {
  if (!Number.isFinite(d)) return "";
  const sign = d >= 0 ? "+" : "";
  return ` (${sign}${d.toFixed(2)}${unit} 30d)`;
}

// ─── Prompt-injection formatter ───────────────────────────────────────
// Returns "" when disabled OR when the payload is missing — matches the
// fundamentals-line pattern: silent-omit on unavailable, never a nag.
export function formatMacroFredBlock(macro) {
  if (!macro || !macro.ok) return "";
  const s = macro.snap;
  const asOfLine = macro.asOf ? ` (as of ${macro.asOf})` : "";
  const hyOas = s.BAMLH0A0HYM2EY?.latest;
  const igOas = s.BAMLC0A0CMEY?.latest;
  const hyIgSpread = (Number.isFinite(hyOas) && Number.isFinite(igOas))
    ? (hyOas - igOas) * 100
    : null;

  const lines = [];
  lines.push(`\nMACRO REGIME (FRED${asOfLine}):`);
  lines.push(`  Regime hint: ${macro.regime}`);
  lines.push(`  Rates: 10Y ${fmtPct(s.DGS10?.latest)} (real ${fmtPct(s.DFII10?.latest)}, breakeven ${fmtPct(s.T10YIE?.latest)}); Fed funds ${fmtPct(s.FEDFUNDS?.latest)}; 2s10s spread ${fmtPct(s.T10Y2Y?.latest)}${trendTag(s.T10Y2Y?.delta30)}`);
  lines.push(`  Credit: HY OAS yield ${fmtPct(hyOas)}${trendTag(s.BAMLH0A0HYM2EY?.delta30)}; IG OAS yield ${fmtPct(igOas)}; HY-IG spread ${bps(hyIgSpread)}`);
  lines.push(`  Vol/FX: VIX ${fmtNum(s.VIXCLS?.latest, 1)}${trendTag(s.VIXCLS?.delta30, "")}; DXY ${fmtNum(s.DTWEXBGS?.latest, 1)}${trendTag(s.DTWEXBGS?.delta30, "")}; CAD/USD ${fmtNum(s.DEXCAUS?.latest, 4)}`);
  lines.push(`  Commodities/Consumer: WTI $${fmtNum(s.WTISPLC?.latest, 2)}${trendTag(s.WTISPLC?.delta30, "$")}; 30Y mortgage ${fmtPct(s.MORTGAGE30US?.latest)}`);
  lines.push(`  How to read: the regime hint above is a HINT, not a directive — reason from the individual numbers. Rising real yields hurt long-duration growth; widening HY-IG spreads flag credit stress; inverted 2s10s is a classic recession lead indicator; VIX >25 is risk-off.`);
  return lines.join("\n");
}
