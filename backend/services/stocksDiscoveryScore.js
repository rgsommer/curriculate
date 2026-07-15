// backend/services/stocksDiscoveryScore.js
//
// Multi-factor scoring for the "high-conviction" discovery screen. This is
// the TRANSPARENT, reproducible half of the engine: four of the six modules
// (fundamentals, momentum, technical, risk-control) are scored 0-100 here in
// code from FMP + Yahoo data, each with an explicit list of the data points
// that moved the score and flags for anything missing/stale. The remaining
// two modules (catalysts, sentiment) are filled by the AI/web_search layer in
// stocksDiscoveryService.js. The final blended 0-100 is computed here from the
// six sub-scores × the risk-mode weights, so the number is always explainable.
//
// Nothing here promises winners. Sub-scores are evidence strength, not
// certainty; a high score with thin data yields LOW confidence.

import { getTechnicals } from "./stocksTechnicals.js";
import { getFundamentals } from "./stocksFundamentals.js";
import { getCatalysts } from "./stocksCatalystsFmp.js";

// ── Risk-mode weight presets (each sums to 1.0) ────────────────────────
// "balanced" matches the spec exactly. The others re-tilt emphasis without
// ever dropping a module to zero — every lens still contributes.
export const RISK_MODES = {
  conservative: { fundamentals: 0.32, momentum: 0.12, technical: 0.12, catalysts: 0.14, sentiment: 0.08, riskControl: 0.22 },
  balanced:     { fundamentals: 0.25, momentum: 0.20, technical: 0.15, catalysts: 0.20, sentiment: 0.10, riskControl: 0.10 },
  aggressive:   { fundamentals: 0.18, momentum: 0.26, technical: 0.16, catalysts: 0.26, sentiment: 0.08, riskControl: 0.06 },
  speculative:  { fundamentals: 0.12, momentum: 0.26, technical: 0.14, catalysts: 0.30, sentiment: 0.12, riskControl: 0.06 },
};

export function weightsFor(riskMode) {
  return RISK_MODES[riskMode] || RISK_MODES.balanced;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Yahoo daily history (for returns + relative strength) ──────────────
function resolveSymbol(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(".")) return t;
  return currency === "CAD" ? `${t}.TO` : t;
}

export async function fetchYahooDaily(symbol, range = "1y") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate)" } });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const vols = result?.indicators?.quote?.[0]?.volume || [];
    const points = [];
    for (let i = 0; i < ts.length; i++) {
      if (Number.isFinite(closes[i])) points.push({ t: ts[i], close: closes[i], vol: vols[i] ?? null });
    }
    return points.length ? points : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// % return over the last N trading days (approx N≈21/mo) ending at the latest bar.
function trailingReturnPct(points, days) {
  if (!points || points.length < days + 1) return null;
  const last = points[points.length - 1].close;
  const prior = points[points.length - 1 - days].close;
  if (!prior) return null;
  return ((last - prior) / prior) * 100;
}

export function computeReturns(points) {
  return {
    r3m: trailingReturnPct(points, 63),
    r6m: trailingReturnPct(points, 126),
    r12m: trailingReturnPct(points, 252),
  };
}

// ── Module 1: Fundamentals (0-100) ─────────────────────────────────────
// f: shape from fetchCandidateFundamentals / getFundamentals merged.
export function scoreFundamentals(f, marketCap) {
  const contributors = [];
  const flags = [];
  if (!f) { flags.push("Fundamentals unavailable (no FMP data)"); return { score: null, contributors, flags }; }
  let score = 0;
  const add = (pts, label) => { score += pts; contributors.push(`${label} → +${pts}`); };

  const rg = f.revenueGrowthPct;
  if (rg != null) {
    if (rg >= 50) add(30, `Revenue growth ${rg.toFixed(0)}%`);
    else if (rg >= 30) add(24, `Revenue growth ${rg.toFixed(0)}%`);
    else if (rg >= 20) add(18, `Revenue growth ${rg.toFixed(0)}%`);
    else if (rg >= 10) add(10, `Revenue growth ${rg.toFixed(0)}%`);
    else if (rg >= 0) add(4, `Revenue growth ${rg.toFixed(0)}%`);
    else contributors.push(`Revenue declining ${rg.toFixed(0)}% → +0`);
  } else flags.push("Revenue growth missing");

  const eg = f.operatingIncomeGrowthPct;
  if (eg != null) {
    if (eg >= 50) add(20, `Operating income growth ${eg.toFixed(0)}%`);
    else if (eg >= 20) add(14, `Operating income growth ${eg.toFixed(0)}%`);
    else if (eg >= 0) add(8, `Operating income growth ${eg.toFixed(0)}%`);
    else contributors.push(`Operating income shrinking → +0`);
  } else flags.push("Earnings growth missing");

  const gm = f.grossMarginPct;
  if (gm != null) {
    if (gm >= 60) add(20, `Gross margin ${gm.toFixed(0)}%`);
    else if (gm >= 40) add(15, `Gross margin ${gm.toFixed(0)}%`);
    else if (gm >= 25) add(9, `Gross margin ${gm.toFixed(0)}%`);
    else if (gm >= 10) add(4, `Gross margin ${gm.toFixed(0)}%`);
  } else flags.push("Margins missing");

  const fcf = f.freeCashFlowYieldPct;
  if (fcf != null) {
    if (fcf >= 8) add(15, `FCF yield ${fcf.toFixed(1)}%`);
    else if (fcf >= 4) add(11, `FCF yield ${fcf.toFixed(1)}%`);
    else if (fcf >= 0) add(6, `FCF positive (${fcf.toFixed(1)}%)`);
    else contributors.push(`Negative FCF yield ${fcf.toFixed(1)}% → +0`);
  } else flags.push("Free cash flow missing");

  const de = f.netDebtToEquity;
  if (de != null) {
    if (de < 0.5) add(15, `Low debt/equity ${de.toFixed(2)}`);
    else if (de < 1.0) add(10, `Moderate debt/equity ${de.toFixed(2)}`);
    else if (de < 2.0) add(5, `Elevated debt/equity ${de.toFixed(2)}`);
    else contributors.push(`High debt/equity ${de.toFixed(2)} → +0`);
  } else flags.push("Debt levels missing");

  // Valuation sanity — extreme multiples cap the upside (overpaying risk).
  const ps = f.psTTM, pe = f.peTTM;
  if (ps != null && ps > 30) { score -= 8; contributors.push(`Rich P/S ${ps.toFixed(1)} → −8 (valuation)`); }
  else if (ps != null) contributors.push(`P/S ${ps.toFixed(1)}`);
  if (pe != null && pe > 100) { score -= 6; contributors.push(`Very high P/E ${pe.toFixed(0)} → −6 (valuation)`); }
  // Rough PEG (only when both growth and P/E are positive)
  if (pe != null && pe > 0 && rg != null && rg > 0) {
    const peg = pe / rg;
    contributors.push(`PEG ≈ ${peg.toFixed(2)}${peg < 1 ? " (growth-cheap)" : peg > 3 ? " (growth-expensive)" : ""}`);
    if (peg < 1) score += 5;
  } else flags.push("PEG not computable");

  return { score: clamp(Math.round(score), 0, 100), contributors, flags };
}

// ── Module 2: Growth / momentum (0-100) ────────────────────────────────
export function scoreMomentum(returns, relStrength6mPp, tech) {
  const contributors = [];
  const flags = [];
  let score = 0;
  const add = (pts, label) => { score += pts; contributors.push(`${label} → +${pts}`); };

  if (returns?.r12m != null) {
    if (returns.r12m >= 50) add(25, `12-mo return +${returns.r12m.toFixed(0)}%`);
    else if (returns.r12m >= 20) add(18, `12-mo return +${returns.r12m.toFixed(0)}%`);
    else if (returns.r12m >= 0) add(10, `12-mo return +${returns.r12m.toFixed(0)}%`);
    else add(2, `12-mo return ${returns.r12m.toFixed(0)}%`);
  } else flags.push("12-mo trend missing");

  if (returns?.r6m != null) {
    if (returns.r6m >= 25) add(18, `6-mo return +${returns.r6m.toFixed(0)}%`);
    else if (returns.r6m >= 0) add(10, `6-mo return +${returns.r6m.toFixed(0)}%`);
    else add(3, `6-mo return ${returns.r6m.toFixed(0)}%`);
  } else flags.push("6-mo trend missing");

  if (returns?.r3m != null) {
    if (returns.r3m >= 10) add(10, `3-mo return +${returns.r3m.toFixed(0)}%`);
    else if (returns.r3m >= 0) add(6, `3-mo return +${returns.r3m.toFixed(0)}%`);
    else add(2, `3-mo return ${returns.r3m.toFixed(0)}%`);
  }

  // Relative strength vs S&P 500 (percentage points of 6-mo outperformance)
  if (relStrength6mPp != null) {
    if (relStrength6mPp >= 20) add(25, `Outperforming S&P by ${relStrength6mPp.toFixed(0)}pp (6mo)`);
    else if (relStrength6mPp >= 0) add(15, `Beating S&P by ${relStrength6mPp.toFixed(0)}pp (6mo)`);
    else add(5, `Lagging S&P by ${Math.abs(relStrength6mPp).toFixed(0)}pp (6mo)`);
  } else flags.push("Relative strength vs S&P unavailable");

  // Moving-average structure (20/50/100/200 proxy via 50/200 + price)
  if (tech?.ok && tech.last != null && tech.sma50 != null && tech.sma200 != null) {
    if (tech.last > tech.sma50 && tech.sma50 > tech.sma200) add(20, "Price > 50d > 200d (clean uptrend)");
    else if (tech.last > tech.sma50) add(12, "Price > 50d MA");
    else add(4, "Below 50d MA");
  } else flags.push("Moving averages unavailable");

  if (tech?.recentCross?.type === "golden") contributors.push(`Golden cross ${tech.recentCross.daysAgo}d ago (volume-confirm before acting)`);

  return { score: clamp(Math.round(score), 0, 100), contributors, flags };
}

// ── Module 3: Technical setup (0-100) ──────────────────────────────────
export function scoreTechnical(tech, returns) {
  const contributors = [];
  const flags = [];
  if (!tech?.ok) { flags.push("Technicals unavailable"); return { score: null, contributors, flags }; }
  let score = 0;
  const add = (pts, label) => { score += pts; contributors.push(`${label} → +${pts}`); };

  // RSI — reward healthy/constructive, penalize overbought (overextension)
  if (tech.rsi14 != null) {
    const r = tech.rsi14;
    if (r >= 40 && r <= 65) add(30, `RSI ${r.toFixed(0)} (healthy)`);
    else if (r > 65 && r <= 70) add(18, `RSI ${r.toFixed(0)} (strong)`);
    else if (r >= 30 && r < 40) add(22, `RSI ${r.toFixed(0)} (basing)`);
    else if (r < 30) add(20, `RSI ${r.toFixed(0)} (oversold — needs a catalyst)`);
    else { add(6, `RSI ${r.toFixed(0)} (overbought — overextended)`); }
  } else flags.push("RSI unavailable");

  // Trend strength (price vs 200d + cross) — proxy for MACD/trend
  if (tech.priceVsSma200 != null) {
    if (tech.recentCross?.type === "golden") add(30, "Golden cross + above 200d");
    else if (tech.priceVsSma200 >= 0) add(20, `+${tech.priceVsSma200.toFixed(0)}% above 200d`);
    else add(6, `${tech.priceVsSma200.toFixed(0)}% below 200d`);
    if (tech.recentCross?.type === "death") contributors.push("⚠ Recent death cross");
  } else flags.push("200d trend unavailable");

  // Overextension guard — far above 50d MA is fragile without a catalyst
  if (tech.priceVsSma50 != null) {
    const ext = tech.priceVsSma50;
    if (ext > 40) add(4, `+${ext.toFixed(0)}% over 50d (very extended)`);
    else if (ext > 20) add(12, `+${ext.toFixed(0)}% over 50d (extended)`);
    else add(20, `${ext >= 0 ? "+" : ""}${ext.toFixed(0)}% vs 50d (room to run)`);
  } else flags.push("50d extension unavailable");

  // Volatility band — moderate vol is tradeable; extreme vol is a coin flip
  if (tech.annualizedVolPct != null) {
    const v = tech.annualizedVolPct;
    if (v <= 40) add(20, `Vol ${v.toFixed(0)}% (orderly)`);
    else if (v <= 70) add(12, `Vol ${v.toFixed(0)}% (elevated)`);
    else add(4, `Vol ${v.toFixed(0)}% (whippy)`);
  } else flags.push("Volatility unavailable");

  // We do not compute MACD / Bollinger here — surface that honestly.
  flags.push("MACD/Bollinger not computed (RSI + MA structure used as trend proxy)");

  return { score: clamp(Math.round(score), 0, 100), contributors, flags };
}

// ── Module 6: Risk control (0-100) ─────────────────────────────────────
// Starts at 100 and subtracts for balance-sheet / cash-burn / revenue /
// volatility / size risks. The AI layer can lower it further for dilution or
// "no clear catalyst" (data we don't have deterministically).
export function scoreRiskControl(f, tech, marketCap) {
  const contributors = [];
  const flags = [];
  let score = 100;
  const sub = (pts, label) => { score -= pts; contributors.push(`${label} → −${pts}`); };

  if (f?.netDebtToEquity != null) {
    if (f.netDebtToEquity > 2) sub(30, `Heavy debt/equity ${f.netDebtToEquity.toFixed(2)}`);
    else if (f.netDebtToEquity > 1) sub(12, `Elevated debt/equity ${f.netDebtToEquity.toFixed(2)}`);
    else contributors.push(`Healthy debt/equity ${f.netDebtToEquity.toFixed(2)} → ok`);
  } else flags.push("Debt levels missing — risk understated");

  if (f?.freeCashFlowYieldPct != null && f.freeCashFlowYieldPct < 0) sub(25, "Negative free cash flow (cash burn)");
  if (f?.revenueGrowthPct != null) {
    if (f.revenueGrowthPct < -10) sub(30, `Revenue collapsing ${f.revenueGrowthPct.toFixed(0)}%`);
    else if (f.revenueGrowthPct < 0) sub(12, `Revenue declining ${f.revenueGrowthPct.toFixed(0)}%`);
  }
  if (tech?.annualizedVolPct != null) {
    if (tech.annualizedVolPct > 80) sub(15, `Very high volatility ${tech.annualizedVolPct.toFixed(0)}%`);
    else if (tech.annualizedVolPct > 50) sub(8, `High volatility ${tech.annualizedVolPct.toFixed(0)}%`);
  }
  if (marketCap != null && marketCap < 300_000_000) sub(10, "Micro-cap (<$300M — liquidity/dilution risk)");

  return { score: clamp(Math.round(score), 0, 100), contributors, flags };
}

// ── Blend the six sub-scores into a transparent 0-100 ──────────────────
// Missing modules (null) are dropped and the remaining weights renormalized,
// so a thin-data name isn't silently zeroed — but confidence reflects the gap.
export function blendScore(subScores, weights) {
  let wsum = 0, acc = 0;
  for (const k of Object.keys(weights)) {
    const s = subScores[k]?.score;
    if (s == null || !Number.isFinite(s)) continue;
    acc += s * weights[k];
    wsum += weights[k];
  }
  if (wsum === 0) return null;
  return Math.round(acc / wsum);
}

// A consistent, AI-free "structural conviction" score (0-100) — blends only
// the four deterministic modules. Used for the daily conviction-trend series
// so points are comparable run-to-run (the full composite includes an AI
// narrative layer we can't recompute for free every day).
export function deterministicComposite(sub, riskMode = "balanced") {
  if (!sub) return null;
  const w = weightsFor(riskMode);
  const detW = { fundamentals: w.fundamentals, momentum: w.momentum, technical: w.technical, riskControl: w.riskControl };
  return blendScore(
    { fundamentals: sub.fundamentals, momentum: sub.momentum, technical: sub.technical, riskControl: sub.riskControl },
    detW
  );
}

// Confidence (0-100): how much to trust the score. Driven by data
// completeness (how many modules had real data) minus a penalty for flags.
export function computeConfidence(subScores, extraFlagCount = 0) {
  const keys = Object.keys(subScores);
  const withData = keys.filter((k) => subScores[k]?.score != null).length;
  const completeness = (withData / keys.length) * 100;
  const flagCount = keys.reduce((n, k) => n + (subScores[k]?.flags?.length || 0), 0) + extraFlagCount;
  return clamp(Math.round(completeness - Math.min(30, flagCount * 3)), 5, 95);
}

// Risk rating from risk-control score + volatility + size. The AI may bump it
// up to "Speculative" for hype-only / pre-revenue names.
export function deriveRiskRating(riskControlScore, tech, marketCap) {
  const vol = tech?.annualizedVolPct ?? null;
  if (marketCap != null && marketCap < 300_000_000) return riskControlScore >= 60 ? "High" : "Speculative";
  if (vol != null && vol > 80) return "Speculative";
  if (riskControlScore == null) return "High";
  if (riskControlScore >= 80 && (vol == null || vol <= 35)) return "Low";
  if (riskControlScore >= 60) return "Medium";
  if (riskControlScore >= 40) return "High";
  return "Speculative";
}

// Rules-based projection: entry zone, target, stop, projected ROI %, downside,
// and a time frame — derived from ATR + a risk-mode reward:risk ratio. This is
// a MECHANICAL projection (asymmetric R:R off the volatility-based stop), NOT a
// forecast or promise. Always computable from technicals, so it works for both
// AI picks and the deterministic fallback.
const RR_BY_MODE = { conservative: 1.5, balanced: 2.0, aggressive: 2.5, speculative: 3.0 };
const TIMEFRAME_BY_HORIZON = { "short-term": "~1–3 months", "medium-term": "~3–9 months", "long-term": "~9–18 months" };

export function deriveProjection({ tech, price, riskMode = "balanced", timeHorizon = "medium-term" }) {
  const last = (tech?.ok && Number.isFinite(tech.last)) ? tech.last : (Number.isFinite(price) ? price : null);
  if (last == null || last <= 0) return null;
  const rr = RR_BY_MODE[riskMode] ?? 2.0;
  const atr = (tech?.ok && Number.isFinite(tech.atr14)) ? tech.atr14 : null;
  // Stop = volatility-based (2.5×ATR) when available, else a −15% floor.
  let stop = (tech?.ok && Number.isFinite(tech.suggested25AtrStop) && tech.suggested25AtrStop > 0)
    ? tech.suggested25AtrStop : last * 0.85;
  if (stop >= last) stop = last * 0.85;
  const risk = last - stop;
  const target = last + rr * risk;
  const entryLow = atr ? Math.max(stop, last - atr) : last * 0.97;

  // Fib anchors: the nearest retracement level BELOW current price is a
  // technical support (better limit-buy anchor than pure ATR), and the
  // swing HIGH is a natural resistance target. The AI can cite these
  // directly in entry/exit reasoning.
  const fib = tech?.ok ? tech.fib : null;
  let fibSupport = null, fibResistance = null, fibNote = null;
  if (fib && Array.isArray(fib.levels)) {
    const below = fib.levels.filter((l) => l.price < last).sort((a, b) => b.price - a.price)[0];
    const above = fib.levels.filter((l) => l.price > last).sort((a, b) => a.price - b.price)[0];
    if (below) fibSupport = { pct: below.pct, price: Number(below.price.toFixed(2)) };
    if (above) fibResistance = { pct: above.pct, price: Number(above.price.toFixed(2)) };
    if (fib.inGoldenPocket) fibNote = `🎯 IN GOLDEN POCKET (61.8-65% retrace) — high-conviction reversal zone`;
  }

  return {
    entryZone: `${entryLow.toFixed(2)}–${last.toFixed(2)}`,
    target: Number(target.toFixed(2)),
    stop: Number(stop.toFixed(2)),
    projectedRoiPct: Math.round(((target - last) / last) * 100),
    downsidePct: Math.round(((stop - last) / last) * 100),
    timeframe: TIMEFRAME_BY_HORIZON[timeHorizon] || "~3–9 months",
    rr,
    basis: `Rules-based: 2.5×ATR stop, ${rr}:1 reward target`,
    fibSupport,
    fibResistance,
    fibNote,
  };
}

// ── Moonshot deterministic detectors ──────────────────────────────────
// Pre-parabolic structure: the "coiling before the move" pattern — volatility
// compression + tight multi-month consolidation + holding a rising base +
// positive relative strength + sitting just under resistance WITHOUT already
// being extended. Pattern only; says nothing about whether it breaks out.
export function scorePreParabolic(points, tech, relStrength6mPp) {
  const contributors = [];
  if (!points || points.length < 60 || !tech?.ok) return { score: null, contributors, flags: ["insufficient history"] };
  const closes = points.map((p) => p.close);
  const last = closes[closes.length - 1];
  const yrHigh = Math.max(...closes);
  let score = 0;
  const add = (pts, label) => { score += pts; contributors.push(`${label} → +${pts}`); };
  const stdev = (a) => { if (a.length < 2) return null; const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

  const ret = [];
  for (let i = 1; i < closes.length; i++) ret.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const vRecent = stdev(ret.slice(-20)), vFull = stdev(ret);
  if (vRecent != null && vFull != null && vFull > 0) {
    const ratio = vRecent / vFull;
    if (ratio < 0.6) add(25, `Volatility compressed (recent ${(ratio * 100).toFixed(0)}% of 1y)`);
    else if (ratio < 0.85) add(15, `Volatility easing (${(ratio * 100).toFixed(0)}% of 1y)`);
  }
  const r60 = closes.slice(-60);
  const rng = (Math.max(...r60) - Math.min(...r60)) / last;
  if (rng < 0.18) add(25, `Tight 3-mo consolidation (${(rng * 100).toFixed(0)}% range)`);
  else if (rng < 0.30) add(15, `Moderate consolidation (${(rng * 100).toFixed(0)}% range)`);
  if (tech.priceVsSma200 != null && tech.priceVsSma200 >= 0 && tech.priceVsSma200 < 30) add(20, `Holding above 200d base (+${tech.priceVsSma200.toFixed(0)}%)`);
  if (relStrength6mPp != null && relStrength6mPp >= 0) add(15, `Outperforming S&P (RS +${relStrength6mPp.toFixed(0)}pp)`);
  const distHigh = (yrHigh - last) / yrHigh;
  if (distHigh <= 0.15 && (tech.priceVsSma50 == null || tech.priceVsSma50 < 25)) add(15, `Coiled ${(distHigh * 100).toFixed(0)}% under 52w high, not yet extended`);
  return { score: clamp(Math.round(score), 0, 100), contributors, flags: [] };
}

// Market-reality lag: business improving faster than the stock reflects —
// strong/accelerating fundamentals while price lags the market. High score =
// the kind of mispricing that precedes a re-rating.
export function scoreRealityLag(f, returns, relStrength6mPp) {
  const contributors = [];
  if (!f) return { score: null, contributors, flags: ["fundamentals unavailable"] };
  let fund = 0;
  if (f.revenueGrowthPct != null) fund += f.revenueGrowthPct >= 40 ? 0.5 : f.revenueGrowthPct >= 20 ? 0.3 : f.revenueGrowthPct > 0 ? 0.1 : 0;
  if (f.operatingIncomeGrowthPct != null && f.operatingIncomeGrowthPct > 0) fund += 0.25;
  if (f.grossMarginPct != null && f.grossMarginPct >= 50) fund += 0.15;
  if (f.freeCashFlowYieldPct != null && f.freeCashFlowYieldPct > 0) fund += 0.1;
  fund = Math.min(1, fund);
  let weak = 0;
  if (relStrength6mPp != null) weak = relStrength6mPp < -10 ? 1 : relStrength6mPp < 0 ? 0.7 : relStrength6mPp < 10 ? 0.3 : 0;
  else if (returns?.r6m != null) weak = returns.r6m < 0 ? 0.8 : returns.r6m < 10 ? 0.4 : 0.1;
  const score = clamp(Math.round(100 * fund * weak), 0, 100);
  contributors.push(
    fund > 0.5 && weak > 0.5
      ? `Strong fundamentals (rev ${f.revenueGrowthPct?.toFixed?.(0) ?? "?"}%) but price lagging${relStrength6mPp != null ? ` (RS ${relStrength6mPp.toFixed(0)}pp)` : ""} — possible re-rating setup`
      : `Fundamental strength ${(fund * 100).toFixed(0)}% vs price-lag ${(weak * 100).toFixed(0)}%`
  );
  return { score, contributors, flags: [] };
}

// Compute all four deterministic modules for one candidate. Returns the
// sub-scores plus the raw inputs the AI layer needs.
export async function computeDeterministicFactors({ ticker, currency, marketCap, fmpFundamentals, spyPoints }) {
  const ccy = currency || "USD";
  const sym = resolveSymbol(ticker, ccy);

  const [tech, history, getFund, catalysts] = await Promise.all([
    // Include multi-timeframe confluence — high-conviction picks earn
    // the extra 2 FMP calls per ticker for the pro swing-workflow signal.
    getTechnicals(ticker, ccy, { includeMultiTimeframe: true }).catch(() => ({ ok: false })),
    fetchYahooDaily(sym, "1y").catch(() => null),
    // Merge in getFundamentals (P/E, P/S, sector) if the FMP discovery fetch was thin
    getFundamentals(ticker, ccy).catch(() => ({ ok: false })),
    // Earnings date + analyst actions — swing-catalyst awareness
    getCatalysts(ticker, ccy).catch(() => null),
  ]);

  // Merge the two fundamentals sources (discovery FMP fetch + getFundamentals)
  const f = {
    revenueGrowthPct: fmpFundamentals?.revenueGrowthPct ?? null,
    operatingIncomeGrowthPct: fmpFundamentals?.operatingIncomeGrowthPct ?? null,
    grossMarginPct: fmpFundamentals?.grossMarginPct ?? getFund?.grossMargin ?? null,
    operatingMarginPct: fmpFundamentals?.operatingMarginPct ?? null,
    netDebtToEquity: fmpFundamentals?.netDebtToEquity ?? getFund?.debtToEquity ?? null,
    peTTM: fmpFundamentals?.peTTM ?? getFund?.peRatio ?? null,
    psTTM: fmpFundamentals?.psTTM ?? getFund?.psRatio ?? null,
    freeCashFlowYieldPct: fmpFundamentals?.freeCashFlowYieldPct ?? getFund?.fcfYieldPct ?? null,
  };

  const returns = computeReturns(history);
  let relStrength6mPp = null;
  if (returns.r6m != null && spyPoints) {
    const spyR6 = trailingReturnPct(spyPoints, 126);
    if (spyR6 != null) relStrength6mPp = returns.r6m - spyR6;
  }

  const fundamentals = scoreFundamentals(f, marketCap);
  const momentum = scoreMomentum(returns, relStrength6mPp, tech);
  const technical = scoreTechnical(tech, returns);
  const riskControl = scoreRiskControl(f, tech, marketCap);
  // Moonshot-only detectors (cheap, reuse the already-fetched history).
  const preParabolic = scorePreParabolic(history, tech, relStrength6mPp);
  const realityLag = scoreRealityLag(f, returns, relStrength6mPp);

  // Liquidity: median daily $ volume over the last ~20 sessions (for the
  // short-term illiquid-exit hard reject).
  let liquidityUsdPerDay = null;
  if (Array.isArray(history) && history.length >= 5) {
    const dv = history.slice(-20).map((p) => (Number.isFinite(p.close) && Number.isFinite(p.vol) ? p.close * p.vol : null)).filter((x) => x != null).sort((a, b) => a - b);
    if (dv.length) liquidityUsdPerDay = dv[Math.floor(dv.length / 2)];
  }

  return {
    sub: { fundamentals, momentum, technical, riskControl },
    raw: { tech, returns, relStrength6mPp, fundamentals: f, liquidityUsdPerDay, catalysts },
    moonshot: { preParabolic, realityLag },
  };
}
