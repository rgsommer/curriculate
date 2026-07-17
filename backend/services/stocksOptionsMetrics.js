// backend/services/stocksOptionsMetrics.js
//
// Options-derived signals from Yahoo's public options endpoint (free).
// For each ticker, we fetch the nearest expiry's option chain and compute:
//
//   putCallOIRatio     — total put OI / total call OI. > 1 = bearish
//                        positioning; < 0.7 = bullish crowd.
//   putCallVolRatio    — same over today's volume (more real-time).
//   currentIV          — average IV across near-money strikes (0.5×spot to
//                        1.5×spot). A rough single number for "how much
//                        premium is the market pricing in."
//   ivRankPct          — where currentIV sits vs the last 20 days of the
//                        same computation. High rank = expensive options
//                        (good to SELL premium), low rank = cheap options
//                        (good to BUY premium).
//
// Cached 30min per ticker so a busy briefing doesn't hammer Yahoo.
//
// Yahoo options endpoint:
//   https://query2.finance.yahoo.com/v7/finance/options/{TICKER}

const CACHE = new Map(); // ticker → { fetchedAt, data }
const TTL_MS = 30 * 60 * 1000;
// IV history (last 20 samples per ticker) for computing IV rank
const IV_HISTORY = new Map(); // ticker → [{ivAvg, at}, ...]
const IV_HISTORY_MAX = 20;

async function fetchYahooOptionChain(ticker) {
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Options Reader)" },
    });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.optionChain?.result?.[0];
    if (!result) return null;
    return {
      quote: result.quote || null,
      expiration: result.options?.[0]?.expirationDate || null,
      calls: result.options?.[0]?.calls || [],
      puts: result.options?.[0]?.puts || [],
    };
  } catch { return null; }
}

function computeMetrics(chain) {
  if (!chain) return null;
  const spot = chain.quote?.regularMarketPrice;
  if (!Number.isFinite(spot)) return null;

  const calls = chain.calls || [];
  const puts = chain.puts || [];
  if (calls.length === 0 && puts.length === 0) return null;

  const totalCallOI = calls.reduce((s, c) => s + (c.openInterest || 0), 0);
  const totalPutOI = puts.reduce((s, p) => s + (p.openInterest || 0), 0);
  const totalCallVol = calls.reduce((s, c) => s + (c.volume || 0), 0);
  const totalPutVol = puts.reduce((s, p) => s + (p.volume || 0), 0);

  const putCallOIRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : null;
  const putCallVolRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : null;

  // Average IV across near-money strikes (0.85×spot to 1.15×spot)
  const nearMoney = [...calls, ...puts].filter((o) => {
    return Number.isFinite(o.strike) && o.strike >= spot * 0.85 && o.strike <= spot * 1.15 && Number.isFinite(o.impliedVolatility);
  });
  const currentIV = nearMoney.length > 0
    ? nearMoney.reduce((s, o) => s + o.impliedVolatility, 0) / nearMoney.length * 100
    : null;

  return {
    spot,
    expiration: chain.expiration ? new Date(chain.expiration * 1000).toISOString().slice(0, 10) : null,
    totalCallOI, totalPutOI, totalCallVol, totalPutVol,
    putCallOIRatio, putCallVolRatio,
    currentIVPct: currentIV,
  };
}

function updateIvHistory(ticker, ivPct) {
  if (!Number.isFinite(ivPct)) return;
  const arr = IV_HISTORY.get(ticker) || [];
  arr.push({ ivPct, at: Date.now() });
  while (arr.length > IV_HISTORY_MAX) arr.shift();
  IV_HISTORY.set(ticker, arr);
}

function ivRankPct(ticker, currentIvPct) {
  if (!Number.isFinite(currentIvPct)) return null;
  const arr = IV_HISTORY.get(ticker) || [];
  if (arr.length < 3) return null; // need at least 3 samples for a meaningful rank
  const values = arr.map((h) => h.ivPct);
  const belowOrEqual = values.filter((v) => v <= currentIvPct).length;
  return (belowOrEqual / values.length) * 100;
}

export async function getOptionsMetrics(ticker) {
  const sym = String(ticker || "").toUpperCase();
  if (!sym) return null;
  const now = Date.now();
  const cached = CACHE.get(sym);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  const chain = await fetchYahooOptionChain(sym);
  const metrics = computeMetrics(chain);
  if (!metrics) return null;
  updateIvHistory(sym, metrics.currentIVPct);
  metrics.ivRankPct = ivRankPct(sym, metrics.currentIVPct);

  CACHE.set(sym, { fetchedAt: now, data: metrics });
  return metrics;
}

export function formatOptionsLine(opt) {
  if (!opt) return null;
  const parts = [];
  if (Number.isFinite(opt.putCallOIRatio)) {
    const label = opt.putCallOIRatio > 1.3 ? "bearish" : opt.putCallOIRatio < 0.7 ? "bullish" : "neutral";
    parts.push(`P/C OI ${opt.putCallOIRatio.toFixed(2)} (${label})`);
  }
  if (Number.isFinite(opt.putCallVolRatio)) {
    parts.push(`P/C vol ${opt.putCallVolRatio.toFixed(2)}`);
  }
  if (Number.isFinite(opt.currentIVPct)) {
    parts.push(`IV ${opt.currentIVPct.toFixed(0)}%`);
  }
  if (Number.isFinite(opt.ivRankPct)) {
    const rankLabel = opt.ivRankPct >= 80 ? "🔥 rich" : opt.ivRankPct <= 20 ? "💤 cheap" : "";
    parts.push(`IV rank ${opt.ivRankPct.toFixed(0)}%${rankLabel ? " " + rankLabel : ""}`);
  }
  if (opt.expiration) parts.push(`exp ${opt.expiration}`);
  return parts.length ? `Options: ${parts.join(" · ")}` : null;
}
