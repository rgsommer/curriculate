// backend/services/stocksTechnicals.js
//
// Computes technical indicators from Yahoo Finance daily price history.
// Used by the AI advice + briefing pipelines so the model has reliable
// numbers (RSI, SMA50, SMA200, recent cross events) instead of guessing
// from scraped web pages.
//
// All math is local; the only external call is Yahoo's chart endpoint
// for 1Y of daily closes per ticker. Results are cached for 1h.

const CACHE = new Map(); // ticker → { fetchedAt, data }
// 4h — these are derived from DAILY OHLC bars (RSI, SMA50/200, ATR, crosses),
// which barely move intraday. A longer TTL lets the morning briefing's warm
// cache survive into afternoon user-initiated advice runs (no cold re-fetch).
const TTL_MS = 4 * 60 * 60 * 1000;
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

async function fetchDailyOHLC(ticker, days = 260) {
  const url = `${YAHOO_BASE}${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Tech Indicators)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const closes = q.close || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const opens = q.open || [];
    const volumes = q.volume || [];
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null && Number.isFinite(closes[i])) {
        points.push({
          t: timestamps[i],
          close: closes[i],
          high: Number.isFinite(highs[i]) ? highs[i] : closes[i],
          low: Number.isFinite(lows[i]) ? lows[i] : closes[i],
          open: Number.isFinite(opens[i]) ? opens[i] : closes[i],
          volume: Number.isFinite(volumes[i]) ? volumes[i] : 0,
        });
      }
    }
    return { points: points.slice(-days), currency: result?.meta?.currency || "USD" };
  } finally {
    clearTimeout(tid);
  }
}

function sma(values, n) {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

// Wilder's RSI(14) — the standard
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  // Initial average gain/loss over the first `period` deltas
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  // Wilder smoothing for the rest of the series
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Detect golden/death cross in the last N days. Golden = SMA50 crosses above
// SMA200; Death = SMA50 crosses below. Returns { type, daysAgo } or null.
function recentCross(closes, lookback = 60) {
  if (closes.length < 200 + lookback) return null;
  // Walk back day by day, compute SMA50/200 at each, detect sign flip
  let prevSign = null;
  for (let backIdx = lookback; backIdx >= 0; backIdx--) {
    const endIdx = closes.length - 1 - backIdx;
    if (endIdx < 199) continue;
    const window50 = closes.slice(endIdx - 49, endIdx + 1);
    const window200 = closes.slice(endIdx - 199, endIdx + 1);
    const s50 = window50.reduce((a, b) => a + b, 0) / 50;
    const s200 = window200.reduce((a, b) => a + b, 0) / 200;
    const sign = s50 > s200 ? 1 : -1;
    if (prevSign != null && sign !== prevSign) {
      return { type: sign > 0 ? "golden" : "death", daysAgo: backIdx };
    }
    prevSign = sign;
  }
  return null;
}

// Volume analytics — the missing swing-trade signal. Everything a swing
// trader watches for volume-based edge in one pass over the last 30 days:
//   • RVOL = today's volume / 20d avg — >2 means unusual interest
//   • dry-up = 5d avg < 60% of 20d avg — coiled spring pre-breakout
//   • climax bars = any bar >3x 20d avg in last 5 days — capitulation
//     (down bar) or blow-off (up bar)
//   • pocket pivot = today up AND today's volume > every DOWN day's
//     volume of the prior 10 sessions (O'Neil / Morales signal)
//   • OBV trend 10d = accumulation vs distribution direction
function volumeAnalytics(points) {
  if (!Array.isArray(points) || points.length < 21) return null;
  const vols = points.map((p) => p.volume);
  const last = points.length - 1;
  const todayVol = vols[last];
  const last20 = vols.slice(-21, -1); // prior 20 (exclude today)
  const avg20 = last20.reduce((a, b) => a + b, 0) / 20;
  if (!(avg20 > 0)) return null;
  const rvol = todayVol / avg20;

  const last5 = vols.slice(-5);
  const avg5 = last5.reduce((a, b) => a + b, 0) / 5;
  const dryUp = avg5 < avg20 * 0.6;
  const dryUpRatioPct = (avg5 / avg20) * 100;

  // Climax bars in last 5 sessions
  const climax = [];
  for (let i = points.length - 5; i < points.length; i++) {
    if (i < 0) continue;
    const r = vols[i] / avg20;
    if (r >= 3) {
      const up = points[i].close >= points[i].open;
      climax.push({ daysAgo: points.length - 1 - i, rvol: +r.toFixed(1), direction: up ? "up (blow-off/breakout)" : "down (capitulation/panic)" });
    }
  }

  // Pocket pivot: today up on volume > every down-day volume in the prior 10 sessions
  const todayUp = points[last].close > points[last].open;
  let pocketPivot = false;
  if (todayUp && points.length >= 11) {
    const prior10 = points.slice(-11, -1);
    const maxDownVol = Math.max(0, ...prior10.filter((p) => p.close < p.open).map((p) => p.volume));
    pocketPivot = todayVol > maxDownVol && maxDownVol > 0;
  }

  // OBV — cumulative signed volume — last 10-day slope tells accumulation direction
  let obv = 0;
  const obvSeries = [obv];
  for (let i = 1; i < points.length; i++) {
    const dir = points[i].close > points[i - 1].close ? 1 : points[i].close < points[i - 1].close ? -1 : 0;
    obv += dir * vols[i];
    obvSeries.push(obv);
  }
  const obv10 = obvSeries.slice(-10);
  const obvSlope = obv10[obv10.length - 1] - obv10[0];
  const obvTrend = obvSlope > 0 ? "accumulation" : obvSlope < 0 ? "distribution" : "flat";

  return {
    todayVolume: Math.round(todayVol),
    avg20dVolume: Math.round(avg20),
    rvol: +rvol.toFixed(2),
    dryUp,
    dryUpRatioPct: +dryUpRatioPct.toFixed(0),
    climaxBars: climax,
    pocketPivot,
    obvTrend,
  };
}

// Named-setup detectors — turn OHLC+volume into the specific swing-trade
// patterns human traders name (VCP, bull flag, coiled spring, inside day,
// pocket pivot). Each setup carries a score + concrete evidence + a
// TRIGGER price the trader can act on. The AI cites these directly
// instead of guessing structure from prose.
function detectSetups(points, tech, vol) {
  const setups = [];
  if (!Array.isArray(points) || points.length < 15) return setups;
  const last = points.length - 1;
  const closes = points.map((p) => p.close);

  // Inside day — today's H<yesterday's H AND today's L>yesterday's L.
  // Tight-range continuation; break of parent bar's high/low is the trigger.
  if (points.length >= 2) {
    const t = points[last], y = points[last - 1];
    if (t.high < y.high && t.low > y.low) {
      setups.push({
        name: "Inside day",
        type: "neutral",
        score: 60,
        evidence: [
          `Today's range [$${t.low.toFixed(2)}–$${t.high.toFixed(2)}] contained within yesterday's [$${y.low.toFixed(2)}–$${y.high.toFixed(2)}]`,
          `LONG trigger: break above $${y.high.toFixed(2)}. SHORT trigger: break below $${y.low.toFixed(2)}.`,
        ],
      });
    }
  }

  // Pocket pivot (surfaced from volumeAnalytics as a named setup).
  if (vol?.pocketPivot) {
    setups.push({
      name: "Pocket pivot",
      type: "bullish",
      score: 75,
      evidence: [
        `Today's up-day volume exceeds every down-day volume of the prior 10 sessions`,
        `O'Neil/Morales early-entry signal — institutional accumulation before mainstream attention`,
      ],
    });
  }

  // Coiled spring — 20d vol compressed to <70% of 60d vol while price still above SMA50.
  if (points.length >= 60 && tech?.ok && tech.priceVsSma50 != null) {
    const returns = [];
    for (let i = 1; i < points.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
    const v20 = sd(returns.slice(-20));
    const v60 = sd(returns.slice(-60));
    if (v60 > 0 && v20 / v60 < 0.70 && tech.priceVsSma50 >= 0) {
      setups.push({
        name: "Coiled spring (volatility squeeze)",
        type: "bullish",
        score: 70,
        evidence: [
          `20d realized vol is ${((v20 / v60) * 100).toFixed(0)}% of 60d — coiling`,
          `Price ${tech.priceVsSma50 >= 0 ? "above" : "below"} SMA50 (+${tech.priceVsSma50.toFixed(1)}%) — uptrend intact`,
          `Breakout trigger: any day closing >2×20d ATR above today on RVOL >1.5`,
        ],
      });
    }
  }

  // Bull flag — 5-day pole ≥10%, then 3-8 day tight consolidation with declining volume.
  if (points.length >= 15) {
    for (let poleEnd = last - 3; poleEnd >= last - 8; poleEnd--) {
      if (poleEnd < 5) continue;
      const poleStart = poleEnd - 5;
      const poleGain = (points[poleEnd].close - points[poleStart].close) / points[poleStart].close;
      if (poleGain < 0.10) continue;
      const flag = points.slice(poleEnd + 1);
      if (flag.length < 3 || flag.length > 8) continue;
      const flagHi = Math.max(...flag.map((p) => p.high));
      const flagLo = Math.min(...flag.map((p) => p.low));
      const flagRange = (flagHi - flagLo) / points[poleEnd].close;
      if (flagRange > 0.10) continue;
      const poleVolAvg = points.slice(poleStart, poleEnd + 1).reduce((s, p) => s + p.volume, 0) / 6;
      const flagVolAvg = flag.reduce((s, p) => s + p.volume, 0) / flag.length;
      if (poleVolAvg <= 0 || flagVolAvg >= poleVolAvg) continue;
      const poleHi = Math.max(...points.slice(poleStart, poleEnd + 1).map((p) => p.high));
      setups.push({
        name: "Bull flag",
        type: "bullish",
        score: 78,
        evidence: [
          `Pole: +${(poleGain * 100).toFixed(1)}% over 5 sessions ending ${last - poleEnd}d ago`,
          `Flag: ${flag.length}-day consolidation, range ${(flagRange * 100).toFixed(1)}%`,
          `Volume declining in flag to ${((flagVolAvg / poleVolAvg) * 100).toFixed(0)}% of pole avg — clean pattern`,
          `LONG trigger: break above $${poleHi.toFixed(2)} on RVOL >1.5`,
        ],
      });
      break;
    }
  }

  // VCP — 3+ local peaks with each pullback shallower than the last, final contraction <8%.
  if (points.length >= 60) {
    const peaks = [];
    for (let i = 3; i < points.length - 3; i++) {
      const h = points[i].high;
      let isPeak = true;
      for (let j = 1; j <= 3; j++) {
        if (points[i - j].high >= h || points[i + j].high >= h) { isPeak = false; break; }
      }
      if (isPeak) peaks.push({ idx: i, high: h });
    }
    if (peaks.length >= 3) {
      const recent = peaks.slice(-4);
      const contractions = [];
      for (let i = 0; i < recent.length - 1; i++) {
        const p1 = recent[i], p2 = recent[i + 1];
        const troughLow = Math.min(...points.slice(p1.idx, p2.idx + 1).map((x) => x.low));
        contractions.push((p1.high - troughLow) / p1.high);
      }
      const lastPeak = recent[recent.length - 1];
      const finalTrough = Math.min(...points.slice(lastPeak.idx).map((x) => x.low));
      const finalDepth = (lastPeak.high - finalTrough) / lastPeak.high;
      contractions.push(finalDepth);
      let shrinking = true;
      for (let i = 1; i < contractions.length; i++) {
        if (contractions[i] > contractions[i - 1] * 0.85) { shrinking = false; break; }
      }
      if (shrinking && contractions.length >= 3 && finalDepth < 0.08) {
        setups.push({
          name: "VCP (Volatility Contraction Pattern)",
          type: "bullish",
          score: 85,
          evidence: [
            `${contractions.length} shrinking contractions: ${contractions.map((c) => (c * 100).toFixed(1) + "%").join(" → ")}`,
            `Final contraction only ${(finalDepth * 100).toFixed(1)}% — tight pivot`,
            `LONG trigger: break above pivot high $${lastPeak.high.toFixed(2)} on RVOL >1.5 (Minervini standard)`,
          ],
        });
      }
    }
  }

  return setups.sort((a, b) => b.score - a.score);
}

// Fibonacci retracement from swing high↔low over `lookback` days of intraday
// bars. Traders treat these ratios as high-probability reversal zones — the
// 61.8-65% band ("golden pocket") in particular. Direction is whichever
// extreme was set MOST RECENTLY: if the high came after the low we're in an
// uptrend and levels are pullback targets from the high; the reverse means
// we're in a downtrend and levels are bounce targets from the low.
function fibonacciRetracement(points, lookback = 120) {
  if (!Array.isArray(points) || points.length < 20) return null;
  const slice = points.slice(-lookback);
  let hiIdx = 0, loIdx = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].high > slice[hiIdx].high) hiIdx = i;
    if (slice[i].low < slice[loIdx].low) loIdx = i;
  }
  const swingHigh = slice[hiIdx].high;
  const swingLow = slice[loIdx].low;
  if (!(swingHigh > swingLow)) return null;

  const direction = hiIdx > loIdx ? "uptrend" : "downtrend";
  const range = swingHigh - swingLow;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const levels = ratios.map((r) => ({
    pct: +(r * 100).toFixed(1),
    // Uptrend: 0% = high (nothing retraced), 100% = low (full retrace)
    // Downtrend: 0% = low, 100% = high
    price: direction === "uptrend"
      ? swingHigh - range * r
      : swingLow + range * r,
  }));

  const last = slice[slice.length - 1].close;
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  let zoneLower = null, zoneUpper = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (last >= sorted[i].price && last <= sorted[i + 1].price) {
      zoneLower = sorted[i]; zoneUpper = sorted[i + 1]; break;
    }
  }
  let nearest = sorted[0], minDist = Math.abs(last - sorted[0].price);
  for (const l of sorted) {
    const d = Math.abs(last - l.price);
    if (d < minDist) { minDist = d; nearest = l; }
  }
  const goldenPocket = direction === "uptrend"
    ? { min: swingHigh - range * 0.65, max: swingHigh - range * 0.618 }
    : { min: swingLow + range * 0.618, max: swingLow + range * 0.65 };
  const inGoldenPocket = last >= goldenPocket.min && last <= goldenPocket.max;

  return {
    direction,
    swingHigh, swingLow,
    swingHighDaysAgo: slice.length - 1 - hiIdx,
    swingLowDaysAgo: slice.length - 1 - loIdx,
    lookbackDays: slice.length,
    levels,
    currentPrice: last,
    nearestLevel: nearest,
    nearestDistancePct: last ? (minDist / last) * 100 : null,
    zoneLower, zoneUpper,
    goldenPocket,
    inGoldenPocket,
  };
}

// Resolve the exchange listing to fetch from Yahoo. A CAD-held name with a
// bare symbol (e.g. ENB) must hit the TSX listing (ENB.TO), not the US ADR —
// otherwise the technicals (RSI/SMA/ATR/last price) are computed off the wrong
// market and in the wrong currency. Mirrors normalizeForFmp in
// stocksFundamentals.js so both signal sources agree on the listing.
function resolveSymbol(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(".")) return t;          // already exchange-qualified
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

export async function getTechnicals(ticker, currency = null) {
  const now = Date.now();
  const sym = resolveSymbol(ticker, currency);
  const cached = CACHE.get(sym);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  let data;
  try {
    const { points, currency: nativeCcy } = await fetchDailyOHLC(sym, 260);
    if (points.length < 50) {
      data = { ok: false, reason: "insufficient history" };
    } else {
      const closes = points.map(p => p.close);
      const last = closes[closes.length - 1];
      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);
      const rsi14 = rsi(closes, 14);
      const cross = recentCross(closes, 60);

      // Volatility — std dev of daily returns over last 20 days (annualised)
      let vol = null;
      if (closes.length >= 21) {
        const returns = [];
        for (let i = closes.length - 20; i < closes.length; i++) {
          returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
        vol = Math.sqrt(variance) * Math.sqrt(252) * 100; // annualised %
      }

      // ATR(14) — average true range. The senior-analyst sizing tool.
      // TR = max(high-low, |high-prevClose|, |low-prevClose|)
      let atr14 = null;
      if (points.length >= 15) {
        const trs = [];
        for (let i = 1; i < points.length; i++) {
          const p = points[i], prev = points[i - 1];
          const tr = Math.max(
            p.high - p.low,
            Math.abs(p.high - prev.close),
            Math.abs(p.low - prev.close)
          );
          trs.push(tr);
        }
        // Wilder smoothing
        let atr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
        for (let i = 14; i < trs.length; i++) {
          atr = (atr * 13 + trs[i]) / 14;
        }
        atr14 = atr;
      }

      data = {
        ok: true,
        currency: nativeCcy || currency || null,
        last,
        sma20, sma50, sma200,
        rsi14,
        recentCross: cross,
        annualizedVolPct: vol,
        atr14,
        atrPctOfPrice: atr14 != null && last ? (atr14 / last) * 100 : null,
        priceVsSma50: sma50 ? ((last - sma50) / sma50) * 100 : null,
        priceVsSma200: sma200 ? ((last - sma200) / sma200) * 100 : null,
        // Suggested 2.5-ATR stop level (the senior-analyst default)
        suggested25AtrStop: atr14 != null ? last - 2.5 * atr14 : null,
        // Fibonacci retracement over a 6-month swing window — pullback /
        // bounce zones the AI can cite as concrete support/resistance.
        fib: fibonacciRetracement(points, 120),
        // Volume — RVOL, dry-up, climax bars, pocket pivot, OBV trend.
        // The single biggest missing signal for swing setups.
        volume: volumeAnalytics(points),
      };
      // Named-setup detection depends on tech + vol being computed —
      // add it AFTER the main data block so it can consume them.
      data.setups = detectSetups(points, data, data.volume);
    }
  } catch (e) {
    data = { ok: false, reason: e?.message || "fetch failed" };
  }

  CACHE.set(sym, { fetchedAt: now, data });
  return data;
}

// Convenience: format a technicals object as one human-readable line for
// injection into the AI prompt.
export function formatTechnicalsLine(t) {
  if (!t || !t.ok) return `Technicals: unavailable${t?.reason ? ` (${t.reason})` : ""}`;
  const parts = [];
  if (t.rsi14 != null) {
    const label = t.rsi14 > 70 ? "overbought" : t.rsi14 < 30 ? "oversold" : "neutral";
    parts.push(`RSI ${t.rsi14.toFixed(0)} (${label})`);
  }
  if (t.sma50 != null && t.priceVsSma50 != null) {
    parts.push(`SMA50 $${t.sma50.toFixed(2)} (${t.priceVsSma50 >= 0 ? "+" : ""}${t.priceVsSma50.toFixed(1)}%)`);
  }
  if (t.sma200 != null && t.priceVsSma200 != null) {
    parts.push(`SMA200 $${t.sma200.toFixed(2)} (${t.priceVsSma200 >= 0 ? "+" : ""}${t.priceVsSma200.toFixed(1)}%)`);
  }
  if (t.recentCross) {
    parts.push(`${t.recentCross.type === "golden" ? "🌟 golden cross" : "💀 death cross"} ${t.recentCross.daysAgo}d ago`);
  }
  if (t.annualizedVolPct != null) parts.push(`vol ${t.annualizedVolPct.toFixed(0)}%`);
  if (t.atr14 != null) {
    // atrPctOfPrice / suggested25AtrStop are null when last price is missing.
    const pctStr = Number.isFinite(t.atrPctOfPrice) ? ` (${t.atrPctOfPrice.toFixed(1)}%)` : "";
    const stopStr = Number.isFinite(t.suggested25AtrStop) ? ` → 2.5×ATR stop $${t.suggested25AtrStop.toFixed(2)}` : "";
    parts.push(`ATR $${t.atr14.toFixed(2)}${pctStr}${stopStr}`);
  }
  const fibLine = formatFibLine(t.fib);
  if (fibLine) parts.push(fibLine);
  const volLine = formatVolumeLine(t.volume);
  if (volLine) parts.push(volLine);
  const setupLine = formatSetupsLine(t.setups);
  if (setupLine) parts.push(setupLine);
  return parts.join(" · ");
}

// One-line named-setup summary. Each setup shows type + score + name
// so the AI can pick which to cite. The full evidence array lives on
// t.setups for card UI or deeper reasoning.
export function formatSetupsLine(setups) {
  if (!Array.isArray(setups) || setups.length === 0) return null;
  const parts = setups.slice(0, 3).map((s) => {
    const emoji = s.type === "bullish" ? "🟢" : s.type === "bearish" ? "🔴" : "⚪";
    return `${emoji} ${s.name} (${s.score})`;
  });
  return `Setups: ${parts.join(" · ")}`;
}

// One-line volume summary. Traders read the whole story from these:
// RVOL says "unusual attention today," dry-up says "coiled spring,"
// climax says "something just happened at capitulation intensity,"
// pocket pivot is the O'Neil breakout confirmation signal, OBV says
// "smart money quietly accumulating or unloading."
export function formatVolumeLine(v) {
  if (!v) return null;
  const parts = [];
  const rvolFlag = v.rvol >= 3 ? " 🔥" : v.rvol >= 2 ? " ⚡" : v.rvol < 0.5 ? " 💤" : "";
  parts.push(`RVOL ${v.rvol.toFixed(2)}x${rvolFlag}`);
  if (v.dryUp) parts.push(`💤 dry-up (5d vol ${v.dryUpRatioPct}% of 20d avg — pre-breakout compression)`);
  if (Array.isArray(v.climaxBars) && v.climaxBars.length) {
    parts.push(`💥 climax bar${v.climaxBars.length > 1 ? "s" : ""}: ${v.climaxBars.map((c) => `${c.daysAgo}d ago ${c.rvol}x ${c.direction}`).join(", ")}`);
  }
  if (v.pocketPivot) parts.push(`🎯 POCKET PIVOT (up-day vol > every down-day vol of prior 10 sessions — O'Neil breakout signal)`);
  parts.push(`OBV ${v.obvTrend}`);
  return `Volume: ${parts.join(" · ")}`;
}

// One-line Fib summary for prompt injection. Shows the 6mo swing high/low,
// which direction the retracement is drawn from, where current price sits
// relative to the nearest level, and whether we're in the "golden pocket"
// (61.8-65% retrace — the highest-probability reversal zone). The AI uses
// these as CONCRETE support/resistance anchors when picking entries/exits.
export function formatFibLine(fib) {
  if (!fib) return null;
  const dir = fib.direction === "uptrend" ? "↑ from $" + fib.swingLow.toFixed(2) + " → $" + fib.swingHigh.toFixed(2)
                                          : "↓ from $" + fib.swingHigh.toFixed(2) + " → $" + fib.swingLow.toFixed(2);
  const near = fib.nearestLevel;
  const dist = fib.nearestDistancePct != null ? ` (${fib.nearestDistancePct.toFixed(1)}% away)` : "";
  const zone = fib.zoneLower && fib.zoneUpper
    ? `zone ${fib.zoneLower.pct}%→${fib.zoneUpper.pct}% [$${fib.zoneLower.price.toFixed(2)}–$${fib.zoneUpper.price.toFixed(2)}]`
    : "outside range";
  const gp = fib.inGoldenPocket ? " · 🎯 GOLDEN POCKET (high-conviction reversal zone)" : "";
  // Include the four most-watched levels explicitly so the AI can quote them.
  const keyLevels = fib.levels
    .filter((l) => [23.6, 38.2, 50, 61.8, 78.6].includes(l.pct))
    .map((l) => `${l.pct}%=$${l.price.toFixed(2)}`)
    .join(", ");
  return `Fib ${fib.direction} ${dir} · ${zone} · nearest ${near.pct}%=$${near.price.toFixed(2)}${dist} · levels [${keyLevels}]${gp}`;
}
