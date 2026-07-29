// backend/services/stocksDisciplineBacktest.js
//
// Pass A: honest backtest of the DISCIPLINE FRAMEWORK against the user's
// actual current portfolio. Does NOT try to backtest AI advice (that would
// be data-leaked and dishonest — today's Claude already knows what happened).
// Isolates one testable question:
//
//   "If I had held these exact positions for the last N years, would
//    mechanical trailing-stop discipline have helped or hurt vs pure
//    buy-and-hold, and vs a passive index?"
//
// Three scenarios per run:
//   1. HOLD      — buy the current position sizes N years ago, hold to today
//   2. STOPS     — same, but with a 20% trailing-stop-from-peak per position;
//                  proceeds sit in cash from the day the stop triggers
//   3. REDEPLOY  — same as STOPS, but proceeds are reinvested into an index
//                  proxy (SPY for USD holdings, XIC.TO for CAD) on the same day
//
// Plus one external benchmark: 100% XEQT.TO from day zero for the same
// starting notional — the "did nothing fancy" reference line.
//
// All prices via Yahoo Finance (works for US + Canadian .TO listings).
// FX simplified to a constant — the noise from historical FX is small
// at 5y horizons vs the discipline effect being measured.

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const FETCH_TIMEOUT_MS = 8000;

// Yahoo range parameter — must be a preset. We fetch the smallest range
// that covers the requested window; day-count trim happens client-side.
function yahooRangeForYears(years) {
  if (years >= 10) return "10y";
  if (years >= 5) return "5y";
  if (years >= 2) return "2y";
  if (years >= 1) return "1y";
  return "6mo";
}

// Fetch adjusted-close daily bars from Yahoo for one ticker.
async function fetchHistory(ticker, years) {
  const range = yahooRangeForYears(years);
  const url = `${YAHOO_BASE}${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Backtest)" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) return null;
    const times = result.timestamp || [];
    const rawClose = result.indicators?.quote?.[0]?.close || [];
    const adj = result.indicators?.adjclose?.[0]?.adjclose || rawClose;
    const points = [];
    for (let i = 0; i < times.length; i++) {
      const c = adj[i];
      if (Number.isFinite(c) && c > 0) points.push({ t: times[i], close: c });
    }
    return {
      ticker,
      currency: result.meta?.currency || "USD",
      points,
    };
  } catch { return null; }
  finally { clearTimeout(tid); }
}

// Resolve a portfolio position → the Yahoo ticker that reflects the
// exchange the user actually trades on. Mirrors frontend resolveChartTicker.
function chartTickerFor(pos) {
  const raw = String(pos.ticker || "").toUpperCase().replace(/\.+$/, "");
  const hasCadSuffix = /\.(TO|V|NE|CN)$/.test(raw);
  if (pos.ccy === "CAD" && !hasCadSuffix) return `${raw}.TO`;
  return raw;
}

// Common-name → canonical alias (same list the price validator uses).
const TICKER_ALIASES = {
  "RBC": "RY", "ROYAL": "RY", "SCOTIA": "BNS", "CIBC": "CM",
  "ENBRIDGE": "ENB", "FORTIS": "FTS", "MANULIFE": "MFC",
  "GOOGLE": "GOOGL", "FACEBOOK": "META", "FB": "META",
  "SQUARE": "XYZ", "SQ": "XYZ",
};

function resolveTicker(pos) {
  const raw = String(pos.ticker || "").toUpperCase().replace(/\.+$/, "");
  const aliased = TICKER_ALIASES[raw] || raw;
  const hasCadSuffix = /\.(TO|V|NE|CN)$/.test(aliased);
  if (pos.ccy === "CAD" && !hasCadSuffix) return `${aliased}.TO`;
  return aliased;
}

/**
 * Run the three simulations for one portfolio + one time window.
 *
 * @param {Array<{ticker:string, qty:number, ccy:string}>} portfolio
 * @param {number} years - lookback window (default 5)
 * @param {Object} opts
 * @param {number} opts.trailStopPct - default 0.20
 * @param {number} opts.fx - USD → CAD, default 1.37
 * @param {string} opts.redeployTickerUsd - default "SPY"
 * @param {string} opts.redeployTickerCad - default "XIC.TO"
 * @param {string} opts.benchmarkTicker - default "XEQT.TO"
 */
export async function runDisciplineBacktest(portfolio, years = 5, opts = {}) {
  const trailStopPct = opts.trailStopPct ?? 0.20;
  const fx = opts.fx ?? 1.37;
  const redeployTickerUsd = opts.redeployTickerUsd || "SPY";
  const redeployTickerCad = opts.redeployTickerCad || "XIC.TO";
  const benchmarkTicker = opts.benchmarkTicker || "XEQT.TO";

  if (!Array.isArray(portfolio) || portfolio.length === 0) {
    return { error: "empty portfolio" };
  }

  // Aggregate lots to (ticker, ccy) → total qty. Skip zero-qty positions.
  const agg = {};
  for (const p of portfolio) {
    if (!p?.ticker || !Number.isFinite(p?.qty) || p.qty <= 0) continue;
    const key = `${p.ticker}|${p.ccy || "USD"}`;
    if (!agg[key]) agg[key] = { ticker: p.ticker, ccy: p.ccy || "USD", qty: 0 };
    agg[key].qty += p.qty;
  }
  const positions = Object.values(agg);
  if (positions.length === 0) return { error: "no positive-qty positions" };

  // Fetch price history for every position + index proxies + benchmark
  const uniqueChartTickers = new Set();
  positions.forEach(p => uniqueChartTickers.add(resolveTicker(p)));
  uniqueChartTickers.add(redeployTickerUsd);
  uniqueChartTickers.add(redeployTickerCad);
  uniqueChartTickers.add(benchmarkTicker);

  const histories = {};
  await Promise.all([...uniqueChartTickers].map(async t => {
    const h = await fetchHistory(t, years);
    if (h) histories[t] = h;
  }));

  // Union of every trading date across all fetched tickers
  const allDatesSet = new Set();
  for (const h of Object.values(histories)) {
    for (const p of h.points) allDatesSet.add(p.t);
  }
  const dates = [...allDatesSet].sort((a, b) => a - b);
  if (dates.length === 0) return { error: "no price data returned" };

  // Trim to only positions whose history actually loaded
  const usable = positions.filter(p => histories[resolveTicker(p)]);
  const missingTickers = positions
    .filter(p => !histories[resolveTicker(p)])
    .map(p => `${p.ticker} (${p.ccy})`);
  if (usable.length === 0) {
    return { error: "no positions had loadable price history", missingTickers };
  }

  // Convert each history to a date → price map, with forward-fill for
  // dates where a ticker didn't trade (weekends, exchange holidays).
  const priceMaps = {};
  for (const [t, h] of Object.entries(histories)) {
    const barByDate = new Map(h.points.map(p => [p.t, p.close]));
    const map = {};
    let last = null;
    for (const d of dates) {
      if (barByDate.has(d)) { last = barByDate.get(d); map[d] = last; }
      else if (last != null) map[d] = last;
    }
    priceMaps[t] = map;
  }

  const positionValueCad = (pos, date) => {
    const price = priceMaps[resolveTicker(pos)]?.[date];
    if (!Number.isFinite(price)) return 0;
    return pos.ccy === "USD" ? pos.qty * price * fx : pos.qty * price;
  };

  const startDate = dates[0];
  const totalStartValue = usable.reduce((s, p) => s + positionValueCad(p, startDate), 0);

  // ── Scenario 1: HOLD (buy-and-hold baseline) ─────────────────────
  const holdPath = dates.map(d => ({
    t: d,
    value: usable.reduce((s, p) => s + positionValueCad(p, d), 0),
  }));

  // ── Scenario 2: STOPS (trailing stop, cash on exit) ──────────────
  const stopState = usable.map(p => ({
    pos: p, active: true, peak: 0, exitDate: null, proceedsCad: 0,
  }));
  const stopEvents = [];
  const stopPath = dates.map(d => {
    let value = 0;
    for (const st of stopState) {
      const price = priceMaps[resolveTicker(st.pos)]?.[d];
      if (!Number.isFinite(price)) continue;
      if (st.active) {
        if (price > st.peak) st.peak = price;
        const stopPrice = st.peak * (1 - trailStopPct);
        if (price < stopPrice && st.peak > 0) {
          st.active = false;
          st.exitDate = d;
          const exitPriceCad = st.pos.ccy === "USD" ? price * fx : price;
          st.proceedsCad = exitPriceCad * st.pos.qty;
          stopEvents.push({
            ticker: st.pos.ticker,
            exitDate: new Date(d * 1000).toISOString().slice(0, 10),
            peakPrice: st.peak,
            exitPrice: price,
            drawdownFromPeakPct: ((price - st.peak) / st.peak) * 100,
            proceedsCad: st.proceedsCad,
          });
        }
        value += st.pos.ccy === "USD" ? st.pos.qty * price * fx : st.pos.qty * price;
      } else {
        value += st.proceedsCad;
      }
    }
    return { t: d, value };
  });

  // ── Scenario 3: REDEPLOY (stop, then reinvest in index) ──────────
  const redeployState = usable.map(p => ({
    pos: p, active: true, peak: 0, indexTicker: null, indexShares: 0,
  }));
  const redeployEvents = [];
  const redeployPath = dates.map(d => {
    let value = 0;
    for (const st of redeployState) {
      const price = priceMaps[resolveTicker(st.pos)]?.[d];
      if (!Number.isFinite(price)) continue;
      if (st.active) {
        if (price > st.peak) st.peak = price;
        const stopPrice = st.peak * (1 - trailStopPct);
        if (price < stopPrice && st.peak > 0) {
          st.active = false;
          const proceedsCad = st.pos.ccy === "USD" ? st.pos.qty * price * fx : st.pos.qty * price;
          const useIdx = st.pos.ccy === "USD" ? redeployTickerUsd : redeployTickerCad;
          const idxPriceRaw = priceMaps[useIdx]?.[d];
          if (Number.isFinite(idxPriceRaw) && idxPriceRaw > 0) {
            const idxIsUsd = histories[useIdx]?.currency === "USD";
            const idxPriceCad = idxIsUsd ? idxPriceRaw * fx : idxPriceRaw;
            st.indexTicker = useIdx;
            st.indexShares = proceedsCad / idxPriceCad;
            redeployEvents.push({
              ticker: st.pos.ticker,
              exitDate: new Date(d * 1000).toISOString().slice(0, 10),
              redeployTo: useIdx,
              proceedsCad,
            });
          } else {
            st.indexTicker = "CASH";
            st.indexShares = proceedsCad;
          }
        }
        value += st.pos.ccy === "USD" ? st.pos.qty * price * fx : st.pos.qty * price;
      } else if (st.indexTicker === "CASH") {
        value += st.indexShares;
      } else if (st.indexTicker) {
        const idxPriceRaw = priceMaps[st.indexTicker]?.[d];
        if (Number.isFinite(idxPriceRaw)) {
          const idxIsUsd = histories[st.indexTicker]?.currency === "USD";
          const idxPriceCad = idxIsUsd ? idxPriceRaw * fx : idxPriceRaw;
          value += st.indexShares * idxPriceCad;
        }
      }
    }
    return { t: d, value };
  });

  // ── Benchmark: 100% XEQT (or equivalent) for same starting notional ─
  let benchPath = [];
  const benchHist = histories[benchmarkTicker];
  if (benchHist && Number.isFinite(priceMaps[benchmarkTicker]?.[startDate])) {
    const idxIsUsd = benchHist.currency === "USD";
    const startIdxPrice = priceMaps[benchmarkTicker][startDate];
    const startCad = idxIsUsd ? startIdxPrice * fx : startIdxPrice;
    const shares = totalStartValue / startCad;
    benchPath = dates.map(d => {
      const p = priceMaps[benchmarkTicker]?.[d];
      const cad = idxIsUsd ? p * fx : p;
      return { t: d, value: Number.isFinite(cad) ? shares * cad : 0 };
    });
  }

  // ── Summary metrics per scenario ─────────────────────────────────
  const summarize = (path) => {
    if (!path || path.length === 0) return null;
    const start = path[0].value;
    const end = path[path.length - 1].value;
    if (!(start > 0)) return null;
    const totalReturn = (end - start) / start;
    const yearsElapsed = (path[path.length - 1].t - path[0].t) / (365.25 * 86400);
    const cagr = yearsElapsed > 0 ? Math.pow(end / start, 1 / yearsElapsed) - 1 : 0;
    let peak = -Infinity, maxDd = 0;
    for (const pt of path) {
      if (pt.value > peak) peak = pt.value;
      const dd = (pt.value - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
    return {
      startValueCad: Math.round(start),
      endValueCad: Math.round(end),
      totalReturnPct: totalReturn * 100,
      cagrPct: cagr * 100,
      maxDrawdownPct: maxDd * 100,
      yearsElapsed,
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    inputs: {
      years,
      trailStopPct,
      fxUsdCad: fx,
      positionCount: usable.length,
      startDate: new Date(startDate * 1000).toISOString().slice(0, 10),
      endDate: new Date(dates[dates.length - 1] * 1000).toISOString().slice(0, 10),
      benchmarkTicker,
      redeployTickerUsd,
      redeployTickerCad,
      tickersFetched: Object.keys(histories),
      tickersMissingHistory: missingTickers,
    },
    scenarios: {
      hold: {
        summary: summarize(holdPath),
        description: `Bought current sizes of ${usable.length} positions ${years} years ago, held straight through.`,
      },
      stops: {
        summary: summarize(stopPath),
        description: `Same starting book with a ${(trailStopPct * 100).toFixed(0)}% trailing stop per position. Proceeds sit as cash from exit day.`,
        stopEventCount: stopEvents.length,
        stopEvents,
      },
      redeploy: {
        summary: summarize(redeployPath),
        description: `Same trailing stop, proceeds redeploy on exit day into ${redeployTickerCad} (CAD holdings) or ${redeployTickerUsd} (USD holdings).`,
        redeployEventCount: redeployEvents.length,
        redeployEvents,
      },
      benchmark: {
        summary: summarize(benchPath),
        description: `100% ${benchmarkTicker} for the same starting notional — passive-aggressive reference.`,
      },
    },
    // Time series for optional chart rendering
    series: {
      dates: dates.map(d => new Date(d * 1000).toISOString().slice(0, 10)),
      hold: holdPath.map(p => p.value),
      stops: stopPath.map(p => p.value),
      redeploy: redeployPath.map(p => p.value),
      benchmark: benchPath.map(p => p.value),
    },
  };
}
