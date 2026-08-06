// backend/services/stocksMarketPulse.js
// ---------------------------------------------------------------------------
// MARKET PULSE — time-of-day-aware recent price action for the daily briefing.
//
// Depending on the ET session when the briefing runs, surfaces the most
// decision-relevant recent tape per key holding:
//   • pre-market  (04:00–09:30 ET): pre-market %chg vs prior close + overnight
//                 momentum, so a gap is visible BEFORE the 9:30 open.
//   • regular     (09:30–16:00 ET): today's %chg + last-few-hours momentum.
//   • after-hours (16:00–20:00 ET): today's close + after-hours %chg.
//   • overnight / weekend: last completed session's %chg + momentum into close.
//
// Sources:
//   • FMP getRealtimeQuote  → session %chg, volume/avg (relative volume),
//                             day range. Currency-normalized, so CAD names
//                             resolve to their TSX listing (no ADR mix-up).
//   • FMP getIntradayBars   → last-few-hours momentum from 1h bars.
//   • Yahoo extended quote  → reliable pre/post-market %chg for US names only
//                             (where extended trading is meaningful and no
//                             .TO resolution is needed — avoids CAD symbol risk).
//
// The block is analytical context, not a trade instruction: the AI is told to
// use it for entry timing / thesis-confirmation, not to restate it verbatim.
// ---------------------------------------------------------------------------

import { getRealtimeQuote, getIntradayBars } from "./stocksIntradayFmp.js";

const TZ = "America/New_York";

// ── Market phase (ET) ──────────────────────────────────────────────────────
// Returns { phase, label, minutesEt, weekday }. Phases:
//   premarket | regular | afterhours | overnight | closed(weekend)
export function marketPhaseNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get("weekday");
  let hh = Number(get("hour"));
  const mm = Number(get("minute"));
  if (hh === 24) hh = 0; // some engines emit "24" at midnight
  const minutesEt = hh * 60 + mm;
  const weekend = weekday === "Sat" || weekday === "Sun";

  if (weekend) return { phase: "closed", label: "weekend — market closed", minutesEt, weekday };
  if (minutesEt >= 240 && minutesEt < 570) return { phase: "premarket", label: "pre-market", minutesEt, weekday }; // 04:00–09:30
  if (minutesEt >= 570 && minutesEt < 960) return { phase: "regular", label: "regular hours", minutesEt, weekday }; // 09:30–16:00
  if (minutesEt >= 960 && minutesEt < 1200) return { phase: "afterhours", label: "after-hours", minutesEt, weekday }; // 16:00–20:00
  return { phase: "overnight", label: "overnight — before pre-market opens", minutesEt, weekday }; // 20:00–04:00
}

// ── Yahoo extended-hours quote (US names only) ─────────────────────────────
const YH_CACHE = new Map();
const YH_TTL_MS = 60 * 1000;

async function fetchYahooExtended(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return {};
  const key = symbols.slice().sort().join(",");
  const hit = YH_CACHE.get(key);
  if (hit && Date.now() - hit.at < YH_TTL_MS) return hit.data;

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate Stocks Pulse)" } });
    if (!r.ok) return {};
    const j = await r.json();
    const rows = j?.quoteResponse?.result || [];
    const map = {};
    for (const q of rows) {
      const t = String(q.symbol || "").toUpperCase();
      map[t] = {
        marketState: q.marketState || null,
        preMarketChangePct: Number.isFinite(q.preMarketChangePercent) ? q.preMarketChangePercent : null,
        postMarketChangePct: Number.isFinite(q.postMarketChangePercent) ? q.postMarketChangePercent : null,
        regularChangePct: Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : null,
      };
    }
    YH_CACHE.set(key, { at: Date.now(), data: map });
    return map;
  } catch {
    return {};
  } finally {
    clearTimeout(tid);
  }
}

// ── Momentum from recent 1h bars ───────────────────────────────────────────
// Looks at the last few completed 1h bars (≈ the last few trading hours),
// returns { pct, label, hours } describing the near-term drift & its shape.
function momentumFromBars(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const recent = bars.slice(-5); // up to last ~4h of movement (5 closes → 4 steps)
  const closes = recent.map((b) => b.close).filter(Number.isFinite);
  if (closes.length < 2) return null;
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (!(first > 0)) return null;
  const pct = ((last - first) / first) * 100;

  const steps = [];
  for (let i = 1; i < closes.length; i++) steps.push(Math.sign(closes[i] - closes[i - 1]));
  const ups = steps.filter((s) => s > 0).length;
  const downs = steps.filter((s) => s < 0).length;
  const lastTwoUp = steps.slice(-2).every((s) => s > 0);
  const lastTwoDown = steps.slice(-2).every((s) => s < 0);

  let label;
  if (Math.abs(pct) < 0.3) label = "flat / chopping sideways";
  else if (pct > 0) label = lastTwoUp ? "accelerating up" : ups >= downs ? "grinding up" : "up but stalling";
  else label = lastTwoDown ? "accelerating down / rolling over" : downs >= ups ? "grinding lower" : "down but stabilizing";

  return { pct, label, hours: closes.length - 1 };
}

// ── Compute ────────────────────────────────────────────────────────────────
export async function computeMarketPulse(profile, topN = 8) {
  const phase = marketPhaseNow();
  const positions = Array.isArray(profile?.positions) ? profile.positions : [];

  const seen = new Set();
  const picks = [];
  for (const p of positions) {
    const ticker = String(p?.ticker || "").toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    picks.push({ ticker, ccy: p.ccy || "USD" });
    if (picks.length >= topN) break;
  }
  if (picks.length === 0) return { phase, rows: [] };

  // Yahoo extended-hours %chg only matters (and is only reliable) for US names
  // in the extended sessions. Skip during regular hours (FMP change covers it).
  let yh = {};
  if (["premarket", "afterhours", "overnight"].includes(phase.phase)) {
    const usSyms = picks.filter((p) => p.ccy === "USD").map((p) => p.ticker);
    if (usSyms.length) yh = await fetchYahooExtended(usSyms);
  }

  const rows = await Promise.all(
    picks.map(async ({ ticker, ccy }) => {
      const [quote, bars] = await Promise.all([
        getRealtimeQuote(ticker, ccy).catch(() => null),
        getIntradayBars(ticker, "1hour", ccy).catch(() => null),
      ]);
      const relVol =
        quote && Number.isFinite(quote.volume) && Number.isFinite(quote.avgVolume) && quote.avgVolume > 0
          ? quote.volume / quote.avgVolume
          : null;
      const ext = yh[ticker] || null;
      return {
        ticker,
        ccy,
        price: Number.isFinite(quote?.price) ? quote.price : null,
        sessionChgPct: Number.isFinite(quote?.changePct) ? quote.changePct : null,
        dayHigh: Number.isFinite(quote?.dayHigh) ? quote.dayHigh : null,
        dayLow: Number.isFinite(quote?.dayLow) ? quote.dayLow : null,
        relVol,
        momentum: momentumFromBars(bars),
        preChgPct: ext?.preMarketChangePct ?? null,
        postChgPct: ext?.postMarketChangePct ?? null,
        marketState: ext?.marketState ?? null,
      };
    })
  );

  return { phase, rows: rows.filter(Boolean) };
}

// ── Format for the prompt ──────────────────────────────────────────────────
const PHASE_HEADER = {
  premarket:
    "MARKET PULSE — PRE-MARKET (before the 9:30 ET open). Gap vs prior close + overnight momentum per holding. Factor gaps into at-open vs post-10am order timing:",
  regular:
    "MARKET PULSE — REGULAR SESSION IN PROGRESS. Today's move + last-few-hours momentum per holding:",
  afterhours:
    "MARKET PULSE — AFTER-HOURS. Today's close + after-hours move per holding:",
  overnight:
    "MARKET PULSE — MARKET CLOSED (before pre-market opens). Last completed session's move + momentum into the close:",
  closed:
    "MARKET PULSE — MARKET CLOSED (weekend). Last completed session's move + momentum into the close:",
};

export function formatMarketPulseBlock(pulse) {
  if (!pulse || !Array.isArray(pulse.rows) || pulse.rows.length === 0) return "";
  const { phase, rows } = pulse;
  const header = PHASE_HEADER[phase.phase] || "MARKET PULSE — recent price action per holding:";
  const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");

  const lines = rows.map((r) => {
    const bits = [];
    if (phase.phase === "premarket" && Number.isFinite(r.preChgPct)) {
      bits.push(`pre-mkt ${fmtPct(r.preChgPct)} vs prior close`);
    } else if (phase.phase === "afterhours") {
      bits.push(`today ${fmtPct(r.sessionChgPct)}${Number.isFinite(r.postChgPct) ? `, after-hrs ${fmtPct(r.postChgPct)}` : ""}`);
    } else {
      bits.push(`${phase.phase === "regular" ? "today" : "last session"} ${fmtPct(r.sessionChgPct)}`);
    }
    if (r.momentum) bits.push(`last ${r.momentum.hours}h ${fmtPct(r.momentum.pct)} — ${r.momentum.label}`);
    if (Number.isFinite(r.relVol)) bits.push(`vol ${r.relVol.toFixed(1)}× avg`);
    if (Number.isFinite(r.dayLow) && Number.isFinite(r.dayHigh)) bits.push(`range ${r.dayLow.toFixed(2)}–${r.dayHigh.toFixed(2)}`);
    return `  ${r.ticker} (${r.ccy}): ${bits.join(" · ")}`;
  });

  return `\n${header}\n${lines.join("\n")}\n(Use this recent tape to judge entry timing and whether each name is confirming or fading its thesis — weave it in where relevant; do not restate it mechanically.)\n`;
}
