// backend/services/stocksFactorAnalysis.js
//
// Decomposes a portfolio into factor exposures so the AI can reason about
// HIDDEN concentrations beyond ticker-level. Two books can hold completely
// different tickers but be the same bet (e.g., both "high-beta US growth").
//
// Factors computed (weighted by CAD market value):
//   - Avg P/E (value-growth tilt)
//   - Avg ROE (quality tilt)
//   - Avg β (risk-on/risk-off exposure)
//   - Avg dividend yield (income tilt)
//   - Sector concentration (top 3 sectors as % of book)
//   - Geographic / currency split (USD vs CAD)
//   - Market-cap distribution (mega/large/mid/small)
//
// All inputs come from the FMP fundamentals already cached by
// stocksFundamentals.js — no extra API calls.

import { getFundamentals } from "./stocksFundamentals.js";

const MARKET_PE_BENCHMARK = 18; // rough S&P 500 LTM P/E baseline
const MARKET_ROE_BENCHMARK = 14; // rough S&P 500 ROE baseline
const MARKET_BETA_BENCHMARK = 1.0;

function classifyMarketCap(mcap) {
  if (mcap == null) return "unknown";
  if (mcap >= 200e9) return "mega";
  if (mcap >= 10e9) return "large";
  if (mcap >= 2e9) return "mid";
  if (mcap >= 300e6) return "small";
  return "micro";
}

export async function computeFactorTilts(profile) {
  const positions = profile?.positions || [];
  const fx = profile?.fxUsdCad || 1.37;
  if (positions.length === 0) return null;

  // Aggregate by ticker so we score each underlying once with its own weight
  const tickerWeights = new Map(); // ticker → { cadWeight, ccy }
  for (const p of positions) {
    if (!p.qty) continue;
    const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    if (!price) continue;
    const cadValue = p.ccy === "USD" ? price * p.qty * fx : price * p.qty;
    if (!tickerWeights.has(p.ticker)) {
      tickerWeights.set(p.ticker, { cadWeight: 0, ccy: p.ccy });
    }
    tickerWeights.get(p.ticker).cadWeight += cadValue;
  }

  // Fetch fundamentals for every ticker in parallel
  const tickers = [...tickerWeights.keys()];
  const fundamentalsPairs = await Promise.all(
    tickers.map(async t => [t, await getFundamentals(t, tickerWeights.get(t).ccy).catch(() => ({ ok: false }))])
  );
  const fundamentalsByTicker = Object.fromEntries(fundamentalsPairs);

  const totalCad = [...tickerWeights.values()].reduce((s, w) => s + w.cadWeight, 0);
  if (totalCad === 0) return null;

  // Weighted accumulators
  let peNum = 0, peWeight = 0;
  let roeNum = 0, roeWeight = 0;
  let betaNum = 0, betaWeight = 0;
  let divNum = 0, divWeight = 0;
  let usdCad = 0;
  const sectorCad = new Map();
  const capCad = { mega: 0, large: 0, mid: 0, small: 0, micro: 0, unknown: 0 };
  const ticker_details = [];

  for (const ticker of tickers) {
    const w = tickerWeights.get(ticker);
    const f = fundamentalsByTicker[ticker];
    const wt = w.cadWeight / totalCad;

    // Currency exposure
    if (w.ccy === "USD") usdCad += w.cadWeight;

    // Sector concentration
    const sector = f?.ok ? (f.sector || "Other") : "Unknown";
    sectorCad.set(sector, (sectorCad.get(sector) || 0) + w.cadWeight);

    // Cap size
    const capBucket = f?.ok ? classifyMarketCap(f.marketCap) : "unknown";
    capCad[capBucket] += w.cadWeight;

    // P/E — only include positive P/E (negative = loss-making, can't average)
    if (f?.ok && f.peRatio != null && f.peRatio > 0 && f.peRatio < 500) {
      peNum += f.peRatio * w.cadWeight;
      peWeight += w.cadWeight;
    }
    // ROE
    if (f?.ok && f.roeTTM != null) {
      roeNum += f.roeTTM * w.cadWeight;
      roeWeight += w.cadWeight;
    }
    // Beta
    if (f?.ok && f.beta != null) {
      betaNum += f.beta * w.cadWeight;
      betaWeight += w.cadWeight;
    }
    // Dividend yield
    if (f?.ok && f.dividendYieldPct != null) {
      divNum += f.dividendYieldPct * w.cadWeight;
      divWeight += w.cadWeight;
    }

    ticker_details.push({
      ticker,
      weightPct: wt * 100,
      ccy: w.ccy,
      sector,
      cap: capBucket,
      peRatio: f?.peRatio ?? null,
      beta: f?.beta ?? null,
      roeTTM: f?.roeTTM ?? null,
      dividendYieldPct: f?.dividendYieldPct ?? null,
    });
  }

  const avgPe = peWeight > 0 ? peNum / peWeight : null;
  const avgRoe = roeWeight > 0 ? roeNum / roeWeight : null;
  const avgBeta = betaWeight > 0 ? betaNum / betaWeight : null;
  const avgDiv = divWeight > 0 ? divNum / divWeight : null;

  // Sector top-3
  const sectorRanked = [...sectorCad.entries()]
    .map(([s, cad]) => ({ sector: s, weightPct: (cad / totalCad) * 100 }))
    .sort((a, b) => b.weightPct - a.weightPct);

  return {
    avgPe, avgRoe, avgBeta, avgDiv,
    pctUsd: (usdCad / totalCad) * 100,
    pctCad: 100 - (usdCad / totalCad) * 100,
    sectorRanked,
    capDistribution: Object.fromEntries(
      Object.entries(capCad).map(([k, v]) => [k, (v / totalCad) * 100])
    ),
    totalCad,
    ticker_details,
  };
}

export function formatFactorBlock(f) {
  if (!f) return "";
  const lines = [];
  lines.push("FACTOR DECOMPOSITION (portfolio's underlying exposures — hidden bets beyond ticker level):");

  // Value/Growth tilt
  if (f.avgPe != null) {
    const peDiff = f.avgPe - MARKET_PE_BENCHMARK;
    const tilt = peDiff > 6 ? "📈 strongly growth-tilted (expensive multiples)" :
                 peDiff > 2 ? "growth-tilted" :
                 peDiff < -4 ? "value-tilted" :
                 "balanced";
    lines.push(`  P/E: ${f.avgPe.toFixed(1)} (market ~${MARKET_PE_BENCHMARK}) — ${tilt}`);
  } else {
    lines.push(`  P/E: unavailable (likely negative-earnings names like DJT excluded from average)`);
  }

  // Quality tilt
  if (f.avgRoe != null) {
    const roeDiff = f.avgRoe - MARKET_ROE_BENCHMARK;
    const tilt = roeDiff > 8 ? "📈 strong quality (high-ROE businesses)" :
                 roeDiff > 0 ? "above-market quality" :
                 roeDiff < -10 ? "📉 low quality (low or negative ROE)" :
                 "below-market quality";
    lines.push(`  ROE: ${f.avgRoe.toFixed(1)}% (market ~${MARKET_ROE_BENCHMARK}%) — ${tilt}`);
  }

  // Beta exposure
  if (f.avgBeta != null) {
    const tilt = f.avgBeta > 1.5 ? "🔥 high-beta (2× market moves = 2× drawdowns)" :
                 f.avgBeta > 1.2 ? "aggressive beta" :
                 f.avgBeta < 0.8 ? "defensive beta" :
                 "market-beta";
    lines.push(`  β: ${f.avgBeta.toFixed(2)} (market = ${MARKET_BETA_BENCHMARK}) — ${tilt}`);
  }

  // Dividend tilt
  if (f.avgDiv != null) {
    const tilt = f.avgDiv > 3 ? "income-tilted" :
                 f.avgDiv > 1.5 ? "some yield" :
                 "growth-focused (low/no yield)";
    lines.push(`  Div yield: ${f.avgDiv.toFixed(2)}% — ${tilt}`);
  }

  // Currency
  lines.push(`  Currency: ${f.pctUsd.toFixed(0)}% USD / ${f.pctCad.toFixed(0)}% CAD`);

  // Sector concentration
  if (f.sectorRanked.length > 0) {
    const top3 = f.sectorRanked.slice(0, 3);
    const top3Total = top3.reduce((s, r) => s + r.weightPct, 0);
    const concentration = top3Total > 80 ? "🔴 heavy concentration"
                        : top3Total > 60 ? "⚠ moderate concentration"
                        : "diversified";
    lines.push(`  Sector: top 3 = ${top3Total.toFixed(0)}% (${concentration})`);
    for (const s of top3) {
      lines.push(`    - ${s.sector}: ${s.weightPct.toFixed(0)}%`);
    }
  }

  // Market cap
  const cap = f.capDistribution || {};
  const capParts = [];
  if (cap.mega > 1) capParts.push(`mega ${cap.mega.toFixed(0)}%`);
  if (cap.large > 1) capParts.push(`large ${cap.large.toFixed(0)}%`);
  if (cap.mid > 1) capParts.push(`mid ${cap.mid.toFixed(0)}%`);
  if (cap.small > 1) capParts.push(`small ${cap.small.toFixed(0)}%`);
  if (cap.micro > 1) capParts.push(`micro ${cap.micro.toFixed(0)}%`);
  if (cap.unknown > 1) capParts.push(`unknown ${cap.unknown.toFixed(0)}%`);
  if (capParts.length) lines.push(`  Market cap: ${capParts.join(", ")}`);

  // Senior-analyst commentary
  lines.push("");
  lines.push("How to use this in recs:");
  lines.push("- Flag if the user is concentrated on a factor they may not realize. E.g. owning DJT + TSLA + RUM + NVDA looks diversified by ticker, but ALL are high-beta growth — one regime shift hits them together.");
  lines.push("- Recommend factor rebalancing trades, not just ticker swaps. \"Add quality (high-ROE) names\" is a different directive than \"buy more stocks.\"");
  lines.push("- When a factor tilt is extreme (β > 1.5, P/E > 30, single sector > 50%), call it out explicitly as a structural risk.");

  return lines.join("\n");
}
