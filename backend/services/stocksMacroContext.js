// backend/services/stocksMacroContext.js
//
// Snapshots the market regime so AI recommendations can be regime-aware.
// Pulls VIX, 10Y yield, USD index, oil, S&P, NASDAQ, TSX, USD/CAD from
// Yahoo Finance and classifies the current regime.
//
// Cached for 30 min (intraday macro doesn't change minute-to-minute).

const CACHE = { fetchedAt: 0, data: null };
const TTL_MS = 30 * 60 * 1000;
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

const MACRO_TICKERS = [
  { sym: "^VIX",      name: "VIX",          unit: "" },
  { sym: "^TNX",      name: "US 10Y yield", unit: "%", scale: 1 }, // ^TNX is already in % (e.g. 4.25 = 4.25%)
  { sym: "DX-Y.NYB",  name: "DXY",          unit: "" },
  { sym: "CL=F",      name: "WTI crude",    unit: " USD/bbl" },
  { sym: "^GSPC",     name: "S&P 500",      unit: "" },
  { sym: "^IXIC",     name: "NASDAQ",       unit: "" },
  { sym: "^GSPTSE",   name: "TSX",          unit: "" },
  { sym: "USDCAD=X",  name: "USD/CAD",      unit: "" },
];

async function fetchTickerHistory(symbol) {
  const url = `${YAHOO_BASE}${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Macro)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(c => c != null && Number.isFinite(c));
    return closes;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function pctChange(closes, daysBack) {
  if (!closes || closes.length < daysBack + 1) return null;
  const cur = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - daysBack];
  return ((cur - prev) / prev) * 100;
}

// Percentile rank of last value in the trailing 252-day window (1Y)
function percentileRank(closes) {
  if (!closes || closes.length < 50) return null;
  const last = closes[closes.length - 1];
  const window = closes.slice(-252);
  const below = window.filter(v => v < last).length;
  return (below / window.length) * 100;
}

export async function getMacroContext() {
  const now = Date.now();
  if (CACHE.data && now - CACHE.fetchedAt < TTL_MS) return CACHE.data;

  const results = await Promise.all(MACRO_TICKERS.map(m => fetchTickerHistory(m.sym)));
  const snap = {};
  MACRO_TICKERS.forEach((m, i) => {
    const closes = results[i];
    if (!closes || closes.length === 0) {
      snap[m.sym] = { ok: false, name: m.name };
      return;
    }
    snap[m.sym] = {
      ok: true,
      name: m.name,
      unit: m.unit || "",
      last: closes[closes.length - 1],
      change1d: pctChange(closes, 1),
      change5d: pctChange(closes, 5),
      change30d: pctChange(closes, 30),
      pctRank1y: percentileRank(closes),
    };
  });

  // Classify the regime — broad strokes the AI can lean on
  const vix = snap["^VIX"];
  const dxy = snap["DX-Y.NYB"];
  const oil = snap["CL=F"];
  const spx = snap["^GSPC"];
  const usdCad = snap["USDCAD=X"];

  const regime = {
    volatility: vix?.last == null ? "unknown" :
                vix.last >= 25 ? "high (risk-off)"
              : vix.last >= 20 ? "elevated"
              : vix.last >= 15 ? "normal"
              : "low (risk-on)",
    dollar:     dxy?.change30d == null ? "unknown" :
                dxy.change30d > 2 ? "strengthening (headwind for non-USD assets)"
              : dxy.change30d < -2 ? "weakening (tailwind for non-USD assets)"
              : "stable",
    rates:      snap["^TNX"]?.change30d == null ? "unknown" :
                snap["^TNX"].change30d > 0.3 ? "rising (pressure on long-duration growth)"
              : snap["^TNX"].change30d < -0.3 ? "falling (tailwind for growth)"
              : "stable",
    risk_appetite: (() => {
      if (vix?.last == null || spx?.change5d == null) return "unknown";
      if (vix.last >= 25 && spx.change5d < -2) return "risk-off (defensive bias)";
      if (vix.last < 16 && spx.change5d > 1) return "risk-on (growth bias)";
      return "neutral";
    })(),
    cad_outlook: usdCad?.change30d == null ? "unknown" :
                 usdCad.change30d > 1.5 ? "CAD weakening (USD asset gains amplified in CAD terms)"
               : usdCad.change30d < -1.5 ? "CAD strengthening (USD asset gains reduced in CAD terms)"
               : "stable",
    oil_trend: oil?.change30d == null ? "unknown" :
               oil.change30d > 5 ? "rising (tailwind for Canadian energy: ENB, SU, CNQ)"
             : oil.change30d < -5 ? "falling (headwind for Canadian energy)"
             : "stable",
  };

  CACHE.data = { snap, regime, fetchedAt: now };
  CACHE.fetchedAt = now;
  return CACHE.data;
}

export function formatMacroBlock(ctx) {
  if (!ctx?.snap) return "";
  const s = ctx.snap;
  const r = ctx.regime;
  const fmt = (sym, prefix = "$") => {
    const x = s[sym];
    if (!x?.ok) return "n/a";
    const val = (sym === "^TNX") ? `${x.last.toFixed(2)}%`
              : (prefix === "$") ? `$${x.last.toFixed(2)}`
              : x.last.toFixed(2);
    const c30 = x.change30d == null ? "" : ` (${x.change30d >= 0 ? "+" : ""}${x.change30d.toFixed(1)}% 30d)`;
    return val + c30;
  };
  return `
MACRO REGIME (read this BEFORE writing recs — every rec should be consistent with the regime):

Snapshot:
  VIX: ${fmt("^VIX", "")} → volatility ${r.volatility}
  10Y yield: ${fmt("^TNX")} → rates ${r.rates}
  DXY: ${fmt("DX-Y.NYB", "")} → dollar ${r.dollar}
  WTI crude: ${fmt("CL=F")} → oil ${r.oil_trend}
  USD/CAD: ${fmt("USDCAD=X", "")} → ${r.cad_outlook}
  S&P 500: ${fmt("^GSPC", "")}; NASDAQ: ${fmt("^IXIC", "")}; TSX: ${fmt("^GSPTSE", "")}

Regime tilt: **${r.risk_appetite}**

How to factor regime into recs:
- If risk-off + rising rates: defer high-multiple US growth adds (NVDA, PLTR, RKLB); lean Canadian dividends (ENB, banks) in Non-Spousal.
- If risk-on + falling rates: growth tailwind; aggressive adds appropriate; momentum names work.
- If oil rising: ENB / SU / CNQ get a sector tailwind; flag if user is underweight.
- If CAD weakening: USD-listed positions gain "free" CAD-equivalent appreciation; don't reinforce by adding more USD exposure without a strategic reason.
- If high VIX (>25): widen stops (the noise is wider); reduce position size on new entries.
`;
}
