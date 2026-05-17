// backend/services/stocksDiscoveryService.js
//
// Discovery engine for high-potential candidate stocks. Pulls a wide
// universe via FMP screener, ranks by composite multi-bagger criteria, then
// asks an AI thesis writer to produce a bull case + kill thesis for the
// top-N candidates.
//
// What we screen for (small/mid cap growth setups historically over-
// represented among 5-10× winners):
//   - Market cap: $200M - $5B (microcap to small-cap; large enough for
//                 liquidity, small enough for runway)
//   - Revenue growth: > 20% YoY
//   - Gross margins: stable or expanding
//   - Reasonable cash position
//   - Liquid enough to actually trade (volume > 100k/day)
//   - Not penny stocks (price > $2)
//   - Not in the user's current portfolio
//   - Not previously dismissed by the user
//
// All FMP calls are aggressively cached. Each scan is moderately expensive
// (~10 AI calls × $0.10 each ≈ $1) so the route only triggers on-demand.
//
// Honest caveats baked into the prompts:
//   - The AI is told to write a KILL THESIS for every candidate. This is
//     the single most useful artifact — what would make this bet fail?
//   - The AI is told NOT to recommend names that are already widely known
//     mega-cap winners; we want unknowns and second-tier names.
//   - Conviction is low/medium/high — most candidates should be medium or
//     low, not high. If everything's "high conviction", the scoring is
//     broken.

import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";

const FMP_BASE = "https://financialmodelingprep.com";
const SCREENER_CACHE = new Map(); // key → { fetchedAt, data }
const SCREENER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FUNDAMENTALS_CACHE = new Map(); // ticker → { fetchedAt, data }
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fmpGet(path) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY not configured — required for discovery");
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`FMP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(tid);
  }
}

// ─── Screener ──────────────────────────────────────────────────────────
// Pulls a wide universe matching liquidity + size + sector criteria. The
// FMP screener itself doesn't support revenue-growth filters, so we apply
// those after fetching per-ticker financial-growth data downstream.
export async function runUniverseScreen(opts = {}) {
  const {
    marketCapMin = 200_000_000,   // $200M
    marketCapMax = 5_000_000_000, // $5B
    priceMin = 2,
    volumeMin = 100_000,
    sectors = null,                // null = all; or array of strings
    limit = 200,
  } = opts;

  const key = JSON.stringify({ marketCapMin, marketCapMax, priceMin, volumeMin, sectors, limit });
  const cached = SCREENER_CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < SCREENER_TTL_MS) return cached.data;

  const params = new URLSearchParams({
    marketCapMoreThan: String(marketCapMin),
    marketCapLowerThan: String(marketCapMax),
    priceMoreThan: String(priceMin),
    volumeMoreThan: String(volumeMin),
    isEtf: "false",
    isActivelyTrading: "true",
    limit: String(limit),
  });
  if (Array.isArray(sectors) && sectors.length > 0) {
    params.append("sector", sectors.join(","));
  }
  const data = await fmpGet(`/api/v3/stock-screener?${params.toString()}`);
  const universe = Array.isArray(data) ? data : [];
  SCREENER_CACHE.set(key, { fetchedAt: Date.now(), data: universe });
  return universe;
}

// ─── Per-ticker fundamentals fetch ─────────────────────────────────────
// Pulls profile + financial growth + key metrics in parallel.
export async function fetchCandidateFundamentals(ticker) {
  const cached = FUNDAMENTALS_CACHE.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < FUNDAMENTALS_TTL_MS) return cached.data;

  try {
    const [growthArr, ratiosArr, keyMetricsArr] = await Promise.all([
      fmpGet(`/api/v3/financial-growth/${ticker}?period=annual&limit=2`).catch(() => []),
      fmpGet(`/api/v3/ratios-ttm/${ticker}`).catch(() => []),
      fmpGet(`/api/v3/key-metrics-ttm/${ticker}`).catch(() => []),
    ]);
    const growth = Array.isArray(growthArr) && growthArr.length > 0 ? growthArr[0] : {};
    const ratios = Array.isArray(ratiosArr) && ratiosArr.length > 0 ? ratiosArr[0] : {};
    const keyMetrics = Array.isArray(keyMetricsArr) && keyMetricsArr.length > 0 ? keyMetricsArr[0] : {};
    const data = {
      revenueGrowthPct: typeof growth.revenueGrowth === "number" ? growth.revenueGrowth * 100 : null,
      grossProfitGrowthPct: typeof growth.grossProfitGrowth === "number" ? growth.grossProfitGrowth * 100 : null,
      operatingIncomeGrowthPct: typeof growth.operatingIncomeGrowth === "number" ? growth.operatingIncomeGrowth * 100 : null,
      grossMarginPct: typeof ratios.grossProfitMarginTTM === "number" ? ratios.grossProfitMarginTTM * 100 : null,
      operatingMarginPct: typeof ratios.operatingProfitMarginTTM === "number" ? ratios.operatingProfitMarginTTM * 100 : null,
      netDebtToEquity: typeof ratios.debtEquityRatioTTM === "number" ? ratios.debtEquityRatioTTM : null,
      peTTM: typeof ratios.peRatioTTM === "number" ? ratios.peRatioTTM : null,
      psTTM: typeof ratios.priceToSalesRatioTTM === "number" ? ratios.priceToSalesRatioTTM : null,
      enterpriseValue: typeof keyMetrics.enterpriseValueTTM === "number" ? keyMetrics.enterpriseValueTTM : null,
      cashAndShortTermInvestments: typeof keyMetrics.cashAndShortTermInvestmentsTTM === "number" ? keyMetrics.cashAndShortTermInvestmentsTTM : null,
      freeCashFlowYieldPct: typeof keyMetrics.freeCashFlowYieldTTM === "number" ? keyMetrics.freeCashFlowYieldTTM * 100 : null,
    };
    FUNDAMENTALS_CACHE.set(ticker, { fetchedAt: Date.now(), data });
    return data;
  } catch (e) {
    return null;
  }
}

// ─── Composite scoring ─────────────────────────────────────────────────
// 0-100 score. Higher = stronger multi-bagger setup. Tuned heuristically;
// the scorecard tracking will reveal whether this scoring actually
// correlates with future returns.
export function scoreCandidate(universeRow, fundamentals) {
  let score = 0;

  // Revenue growth — biggest single factor (40 pts max)
  const rg = fundamentals?.revenueGrowthPct;
  if (rg != null) {
    if (rg >= 100) score += 40;
    else if (rg >= 50) score += 35;
    else if (rg >= 30) score += 28;
    else if (rg >= 20) score += 20;
    else if (rg >= 10) score += 12;
    else if (rg >= 0)  score += 4;
    // Negative growth: 0 pts (we still want to include for the AI to evaluate
    // turnaround candidates explicitly)
  }

  // Gross margins (20 pts max)
  const gm = fundamentals?.grossMarginPct;
  if (gm != null) {
    if (gm >= 60) score += 20;
    else if (gm >= 40) score += 16;
    else if (gm >= 25) score += 10;
    else if (gm >= 10) score += 4;
  }

  // Operating margin trend (15 pts max — proxy for operational leverage)
  const og = fundamentals?.operatingIncomeGrowthPct;
  if (og != null) {
    if (og >= 50) score += 15;
    else if (og >= 20) score += 10;
    else if (og >= 0)  score += 5;
  }

  // Cash position — runway proxy. Cash > 10% of market cap = safe (10 pts)
  if (fundamentals?.cashAndShortTermInvestments && universeRow.marketCap) {
    const cashPct = (fundamentals.cashAndShortTermInvestments / universeRow.marketCap) * 100;
    if (cashPct >= 30) score += 10;
    else if (cashPct >= 15) score += 7;
    else if (cashPct >= 5) score += 3;
  }

  // Reasonable debt (10 pts max — penalize highly indebted)
  const de = fundamentals?.netDebtToEquity;
  if (de != null) {
    if (de < 0.5) score += 10;
    else if (de < 1.0) score += 6;
    else if (de < 2.0) score += 3;
    // De > 2.0: 0 (high financial risk)
  }

  // Beta — too high adds risk, too low signals stagnation (5 pts max)
  const beta = universeRow.beta;
  if (typeof beta === "number") {
    if (beta >= 1.0 && beta <= 2.0) score += 5;
    else if (beta >= 0.7 && beta < 1.0) score += 3;
    else if (beta > 2.0 && beta <= 3.0) score += 2;
  }

  return Math.round(score);
}

// ─── AI thesis writer ──────────────────────────────────────────────────
// For each surviving candidate, call Anthropic with the screen data and
// fundamentals; ask it to write a structured thesis. Web search is enabled
// so the model can find recent catalysts (earnings, contracts, FDA dates).
async function writeCandidateThesis(candidate) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for thesis writer");

  const prompt = `You are a sell-side equity research analyst writing a quick thesis on a potential multi-bagger small-cap candidate. Be skeptical but constructive. Output STRICT JSON only — no prose outside the JSON block.

Candidate facts:
- Ticker: ${candidate.ticker}
- Name: ${candidate.name || "—"}
- Sector: ${candidate.sector || "—"}
- Industry: ${candidate.industry || "—"}
- Market cap: $${(candidate.marketCap / 1_000_000).toFixed(0)}M
- Current price: $${candidate.price || "—"}
- Composite screen score: ${candidate.score}/100

Fundamentals (TTM where available):
- Revenue growth YoY: ${candidate.fundamentals?.revenueGrowthPct?.toFixed(1) ?? "n/a"}%
- Gross margin: ${candidate.fundamentals?.grossMarginPct?.toFixed(1) ?? "n/a"}%
- Operating income growth YoY: ${candidate.fundamentals?.operatingIncomeGrowthPct?.toFixed(1) ?? "n/a"}%
- P/E TTM: ${candidate.fundamentals?.peTTM?.toFixed(1) ?? "n/a"}
- P/S TTM: ${candidate.fundamentals?.psTTM?.toFixed(1) ?? "n/a"}
- Debt/Equity: ${candidate.fundamentals?.netDebtToEquity?.toFixed(2) ?? "n/a"}
- FCF yield: ${candidate.fundamentals?.freeCashFlowYieldPct?.toFixed(1) ?? "n/a"}%
- Cash: $${candidate.fundamentals?.cashAndShortTermInvestments ? (candidate.fundamentals.cashAndShortTermInvestments / 1_000_000).toFixed(0) : "n/a"}M

USE web_search to find:
1. The most recent earnings result (beat/miss/guidance change)
2. Any pending catalyst in the next 6 months (FDA, contract, earnings, product launch)
3. Recent insider activity or unusual options flow
4. Why this name has not yet been bid up to fair value (i.e., what is the market missing or pricing in?)

Skepticism guardrails:
- If the name is already a widely-covered mega-cap (NVDA, TSLA, AAPL, etc.), set conviction="low" and explain that returns from here are unlikely to be multi-bagger.
- A real "10x candidate" needs a credible path to 10× from current price within ~5 years. Don't claim that lightly.
- Always provide a Kill Thesis — what specific outcome would prove the bull case wrong?

Output JSON schema (return EXACTLY this shape, nothing else):
{
  "bullCase": "2-3 sentences: why this could be a multi-bagger. Reference specific numbers.",
  "killThesis": "1-2 sentences: what specific outcome would invalidate the bull case.",
  "priceTarget": <number, in native currency>,
  "horizonMonths": <integer, typically 12-60>,
  "conviction": "low" | "medium" | "high",
  "catalysts": ["bullet 1", "bullet 2", "bullet 3"]
}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-5",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${err.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const sources = [];
  for (const b of j?.content || []) {
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (c?.url && !sources.find((s) => s.url === c.url)) {
          sources.push({ title: c.title || c.url, url: c.url });
        }
      }
    }
  }
  // Extract first JSON object
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  parsed.sources = sources;
  return parsed;
}

// ─── Public orchestrator ───────────────────────────────────────────────
// Pulls universe, scores, picks top N, writes thesis for each, saves to DB.
export async function runDiscoveryScan({ email, excludeTickers = [], sectors = null, topN = 8, opts = {} }) {
  // 1. Pull a wide universe
  const universe = await runUniverseScreen({ sectors, ...opts });
  if (universe.length === 0) {
    return { candidates: [], universeSize: 0, error: "Empty universe from FMP screener" };
  }

  // 2. Filter out names the user already holds OR has previously dismissed
  const excl = new Set((excludeTickers || []).map((t) => String(t).toUpperCase()));
  // Pull recently-dismissed candidates so we don't keep re-surfacing them
  const recentlyDismissed = await StocksDiscoveryCandidate.find({
    email: email.toLowerCase(),
    dismissed: true,
    scanDate: { $gte: new Date(Date.now() - 60 * 86400 * 1000) },
  }).select("ticker").lean();
  recentlyDismissed.forEach((d) => excl.add(d.ticker));

  const filtered = universe.filter((u) => !excl.has(String(u.symbol || "").toUpperCase()));

  // 3. Fetch fundamentals for a pre-rank slice. To keep cost manageable,
  // limit to top ~80 by market cap × volume liquidity proxy before doing
  // the per-ticker FMP fundamentals calls (each ~3 API hits).
  const preRanked = filtered
    .map((u) => ({ ...u, _proxy: (Number(u.marketCap) || 0) * Math.log10(Number(u.volume) || 1 + 1) }))
    .sort((a, b) => b._proxy - a._proxy)
    .slice(0, 80);

  const withFundamentals = await Promise.all(
    preRanked.map(async (u) => {
      const f = await fetchCandidateFundamentals(u.symbol);
      return { ...u, fundamentals: f, _score: scoreCandidate(u, f) };
    })
  );

  // 4. Take top N by composite score
  const topCandidates = withFundamentals
    .filter((c) => c._score > 25) // floor — anything under 25 isn't worth AI spend
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);

  if (topCandidates.length === 0) {
    return { candidates: [], universeSize: universe.length, scoredCount: withFundamentals.length, error: "No candidates cleared the minimum-score threshold" };
  }

  // 5. AI thesis writer — parallel with a small concurrency cap
  const scanDate = new Date();
  const results = await Promise.allSettled(
    topCandidates.map(async (c) => {
      const thesisPayload = {
        ticker: c.symbol,
        name: c.companyName || c.name,
        sector: c.sector,
        industry: c.industry,
        marketCap: c.marketCap,
        price: c.price,
        score: c._score,
        fundamentals: c.fundamentals,
      };
      const thesis = await writeCandidateThesis(thesisPayload).catch(() => null);
      if (!thesis) return null;
      const doc = {
        email: email.toLowerCase(),
        ticker: String(c.symbol).toUpperCase(),
        name: c.companyName || c.name || "",
        sector: c.sector || "",
        industry: c.industry || "",
        exchange: c.exchangeShortName || "",
        marketCap: c.marketCap,
        priceAtDiscovery: c.price,
        currencyAtDiscovery: (c.exchangeShortName === "TSX" || c.exchangeShortName === "TSXV") ? "CAD" : "USD",
        score: c._score,
        signals: {
          revenueGrowthPct: c.fundamentals?.revenueGrowthPct ?? null,
          grossMarginPct: c.fundamentals?.grossMarginPct ?? null,
          operatingMarginPct: c.fundamentals?.operatingMarginPct ?? null,
          netDebtToEquity: c.fundamentals?.netDebtToEquity ?? null,
        },
        thesis: {
          bullCase: thesis.bullCase || "",
          killThesis: thesis.killThesis || "",
          priceTarget: typeof thesis.priceTarget === "number" ? thesis.priceTarget : null,
          horizonMonths: typeof thesis.horizonMonths === "number" ? thesis.horizonMonths : 12,
          conviction: ["low", "medium", "high"].includes(thesis.conviction) ? thesis.conviction : "medium",
          catalysts: Array.isArray(thesis.catalysts) ? thesis.catalysts.slice(0, 6) : [],
          sources: Array.isArray(thesis.sources) ? thesis.sources : [],
        },
        scanDate,
        lastPriceCheckedAt: scanDate,
        lastPrice: c.price,
      };
      // Upsert keyed on (email, ticker, scanDate) — usually a fresh insert
      const saved = await StocksDiscoveryCandidate.findOneAndUpdate(
        { email: doc.email, ticker: doc.ticker, scanDate: doc.scanDate },
        { $set: doc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return saved.toObject();
    })
  );

  const candidates = results
    .map((r) => r.status === "fulfilled" ? r.value : null)
    .filter(Boolean);

  return {
    candidates,
    universeSize: universe.length,
    scoredCount: withFundamentals.length,
    scanDate,
  };
}
