// backend/services/stocksUnusualOptionsFlow.js
//
// Unusual-options-activity (UOA) heuristic. Institutional flow shows
// up as anomalous volume in specific strikes 1-3 days before the move
// hits the tape — that's the classic "smart money" leading signal.
//
// Full paid providers (UnusualWhales, FlowAlgo, CheddarFlow) tag each
// trade with sweep/block/bid-side/ask-side annotations. Yahoo's free
// endpoint gives us only strike + volume + OI — enough for a coarse
// heuristic that catches the loudest ~60% of the signal for zero
// incremental cost:
//
//   For each strike:
//     unusual if volume > 3× openInterest AND volume ≥ 100 contracts
//   For each ticker:
//     directional bias = totalCallVol - totalPutVol (weighted by $)
//     dollar volume    = Σ (strike × 100 × volume × mid_price)
//     tag = "bullish" if call$ > 2× put$, "bearish" if put$ > 2× call$
//
// Rate-limiting: 30-min cache per ticker. Never throws — best-effort
// signal, filtered out of the briefing if nothing looks unusual.

const CACHE = new Map(); // ticker → { fetchedAt, data }
const TTL_MS = 30 * 60 * 1000;

async function fetchChain(ticker) {
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate UOA)" } });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.optionChain?.result?.[0];
    if (!result) return null;
    return {
      spot: result.quote?.regularMarketPrice,
      expiration: result.options?.[0]?.expirationDate,
      calls: result.options?.[0]?.calls || [],
      puts: result.options?.[0]?.puts || [],
    };
  } catch { return null; }
}

// Compute the raw UOA signal for one ticker. Returns null when no
// chain data is available OR when nothing looks unusual.
export async function getUnusualOptionsFlow(ticker) {
  const sym = String(ticker || "").toUpperCase();
  if (!sym) return null;
  const now = Date.now();
  const cached = CACHE.get(sym);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  const chain = await fetchChain(sym);
  if (!chain?.spot) { CACHE.set(sym, { fetchedAt: now, data: null }); return null; }

  const dteDays = chain.expiration ? Math.round((chain.expiration * 1000 - now) / 86400000) : null;

  const unusualStrikes = [];
  let totalCallVol = 0, totalPutVol = 0;
  let totalCallDollar = 0, totalPutDollar = 0;

  const inspect = (row, side) => {
    const vol = row.volume || 0;
    const oi = row.openInterest || 0;
    const strike = row.strike;
    if (!(vol > 0) || !Number.isFinite(strike)) return;
    const bid = row.bid || 0, ask = row.ask || 0;
    const mid = (bid > 0 && ask > 0) ? (bid + ask) / 2 : (bid || ask || row.lastPrice || 0);
    const dollarVol = vol * 100 * mid;
    if (side === "call") { totalCallVol += vol; totalCallDollar += dollarVol; }
    else { totalPutVol += vol; totalPutDollar += dollarVol; }
    // Flag: vol > 3× OI AND vol ≥ 100 contracts AND $ notional ≥ $25k
    // — filters out illiquid noise and picks up real institutional-size
    //   bets. Adjust thresholds as we see false-positive rates.
    const volOiRatio = oi > 0 ? vol / oi : (vol >= 100 ? Infinity : 0);
    if (volOiRatio >= 3 && vol >= 100 && dollarVol >= 25000) {
      unusualStrikes.push({
        side, strike, volume: vol, openInterest: oi,
        volOiRatio: Number.isFinite(volOiRatio) ? Math.round(volOiRatio * 10) / 10 : null,
        dollarVol: Math.round(dollarVol),
        offset: strike > chain.spot ? "OTM" : strike < chain.spot ? "ITM" : "ATM",
        distancePct: ((strike - chain.spot) / chain.spot) * 100,
      });
    }
  };
  for (const row of chain.calls) inspect(row, "call");
  for (const row of chain.puts) inspect(row, "put");

  const callPutDollarRatio = totalPutDollar > 0 ? totalCallDollar / totalPutDollar : (totalCallDollar > 0 ? Infinity : null);
  let bias = "neutral";
  if (callPutDollarRatio != null && callPutDollarRatio >= 2) bias = "bullish";
  else if (callPutDollarRatio != null && callPutDollarRatio > 0 && callPutDollarRatio <= 0.5) bias = "bearish";

  // Nothing to say if no unusual strikes AND the dollar flow isn't skewed enough.
  const anyUnusual = unusualStrikes.length > 0 || bias !== "neutral";
  if (!anyUnusual) { CACHE.set(sym, { fetchedAt: now, data: null }); return null; }

  unusualStrikes.sort((a, b) => b.dollarVol - a.dollarVol);
  const data = {
    ticker: sym,
    spot: chain.spot,
    expiration: chain.expiration ? new Date(chain.expiration * 1000).toISOString().slice(0, 10) : null,
    dteDays,
    bias,
    callPutDollarRatio,
    totalCallDollar: Math.round(totalCallDollar),
    totalPutDollar: Math.round(totalPutDollar),
    unusualStrikes: unusualStrikes.slice(0, 5),
    fetchedAt: now,
  };
  CACHE.set(sym, { fetchedAt: now, data });
  return data;
}

// Sweep a list of tickers in parallel and return the ones with UOA.
// Concurrency-bounded to avoid Yahoo throttling.
export async function scanUnusualOptionsFlow(tickers, { concurrency = 5 } = {}) {
  const uniq = [...new Set((tickers || []).map(t => String(t || "").toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return [];
  const results = [];
  for (let i = 0; i < uniq.length; i += concurrency) {
    const slice = uniq.slice(i, i + concurrency);
    const rows = await Promise.all(slice.map(getUnusualOptionsFlow));
    for (const r of rows) if (r) results.push(r);
  }
  // Rank by directional strength + dollar size — the loudest signals first.
  results.sort((a, b) => (b.totalCallDollar + b.totalPutDollar) - (a.totalCallDollar + a.totalPutDollar));
  return results;
}

// Compact block for injection into the AI briefing prompt.
export function formatUnusualOptionsBlock(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return "";
  const lines = [
    `\nUNUSUAL OPTIONS ACTIVITY (institutional flow — strikes with volume ≥ 3× OI, ≥ 100 contracts, ≥ $25k notional. Directional bias inferred from call$ vs put$ ratio):`,
  ];
  for (const s of signals.slice(0, 8)) {
    const biasEmoji = s.bias === "bullish" ? "🟢" : s.bias === "bearish" ? "🔴" : "⚪";
    const ratio = s.callPutDollarRatio == null ? "—"
      : !Number.isFinite(s.callPutDollarRatio) ? "call-only"
      : s.callPutDollarRatio >= 1 ? `${s.callPutDollarRatio.toFixed(1)}× call$`
      : `${(1 / s.callPutDollarRatio).toFixed(1)}× put$`;
    lines.push(`  ${biasEmoji} ${s.ticker} @ $${s.spot?.toFixed(2)} · ${s.bias.toUpperCase()} · ${ratio} · exp ${s.expiration} (${s.dteDays}d)`);
    for (const u of s.unusualStrikes.slice(0, 3)) {
      const offsetTag = u.offset === "OTM" ? `${u.distancePct >= 0 ? "+" : ""}${u.distancePct.toFixed(1)}%` : u.offset;
      const ratioStr = u.volOiRatio == null ? "vol/OI n/a" : Number.isFinite(u.volOiRatio) ? `vol/OI ${u.volOiRatio}` : `vol/OI ∞ (new)`;
      lines.push(`      ${u.side.toUpperCase()} $${u.strike} (${offsetTag}) · vol ${u.volume.toLocaleString()}, OI ${u.openInterest.toLocaleString()} · ${ratioStr} · $${(u.dollarVol / 1000).toFixed(0)}k notional`);
    }
  }
  lines.push(`\nHow to read:`);
  lines.push(`  - Bullish flow (call$ ≥ 2× put$) 1-3 days BEFORE a name's move is the classic institutional-leading signal. Concentrated OTM call buying is even stronger (asymmetric bet on a specific catalyst).`);
  lines.push(`  - Bearish flow (put$ ≥ 2× call$) especially in OTM puts around earnings or events = hedging or short thesis. Weigh against your existing HOLD calls on the name.`);
  lines.push(`  - This is a HEURISTIC from raw Yahoo chain data — it can't distinguish sweeps from spreads, or bought-at-ask from sold-at-bid. Treat as CORROBORATING evidence, not a standalone trigger. If UOA aligns with a technical setup already on the WATCH list or DISCOVERY POOL, THAT is the actionable combination.`);
  return lines.join("\n");
}
