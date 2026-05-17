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

// FMP-plan-insufficient signal. Thrown when an FMP endpoint returns 403
// (plan doesn't include the endpoint — most commonly the stock-screener
// which requires Starter tier or higher). Callers can catch this and
// gracefully fall back to AI-only discovery.
export class FMPPlanInsufficientError extends Error {
  constructor(path, status) {
    super(`FMP ${status} on ${path} — plan doesn't include this endpoint`);
    this.name = "FMPPlanInsufficientError";
    this.status = status;
    this.path = path;
  }
}

async function fmpGet(path) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY not configured");
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 403) throw new FMPPlanInsufficientError(path, 403);
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
  if (r.status === 429) {
    // Surface rate-limit info so the caller can back off + retry
    const errText = await r.text().catch(() => "");
    const retryAfter = r.headers.get("retry-after");
    const err = new Error(`Anthropic 429: ${errText.slice(0, 200)}`);
    err.status = 429;
    err.retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : null;
    throw err;
  }
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

// Sequential thesis writer with retry-on-429. Anthropic's input-token
// rate limit (default 30K/min) is the bottleneck — firing 8 thesis calls
// in parallel can exceed it. Running 2 at a time with retry on 429 keeps
// usage well under the limit while finishing in ~the same wall-clock
// time as Promise.allSettled would have, minus the retry stalls.
async function mapWithThrottle(items, mapper, { concurrency = 2, maxRetries = 2 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = new Array(items.length).fill(null);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      let lastErr = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          results[i] = await mapper(items[i], i);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (e?.status === 429 || /rate_limit|429/i.test(e?.message || "")) {
            const delaySec = e?.retryAfterSec || (attempt === 0 ? 35 : 65);
            console.warn(`[discovery] 429 on item ${i}, sleeping ${delaySec}s (attempt ${attempt + 1}/${maxRetries + 1})`);
            await sleep(delaySec * 1000);
            continue;
          }
          // Non-rate-limit error: don't retry
          break;
        }
      }
      if (lastErr && results[i] === null) {
        console.warn(`[discovery] item ${i} failed after retries:`, lastErr?.message);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── AI-only prospector (FMP-free fallback) ────────────────────────────
// When FMP screener isn't available (free tier returns 403), ask the AI
// directly to surface candidates given the user's holdings + preferences.
// Less rigorous than a real screener (the AI surfaces well-known names
// more often than obscure ones) but unlocks Discovery without paying for
// FMP Starter.
async function aiOnlyProspect({ email, excludeTickers, sectors, topN, marketCapMin, marketCapMax }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

  const minM = marketCapMin ? `$${(marketCapMin / 1_000_000).toFixed(0)}M` : "$200M";
  const maxM = marketCapMax ? `$${(marketCapMax / 1_000_000).toFixed(0)}M` : "$5B";
  const sectorClause = Array.isArray(sectors) && sectors.length > 0
    ? `Focus on sectors: ${sectors.join(", ")}.`
    : "Sectors are open — bias toward technology, biotech, energy, defense, fintech where 10× setups historically cluster.";
  const excludeClause = excludeTickers.length > 0
    ? `EXCLUDE these tickers (already owned or recently dismissed): ${excludeTickers.join(", ")}.`
    : "";

  const prompt = `You are a sell-side equity research analyst. Find ${topN} potential multi-bagger small-cap stocks the user does NOT already own.

Use the web_search tool to find current candidates. Criteria:
- Market cap roughly between ${minM} and ${maxM}
- Strong revenue growth (>20% YoY) OR a clear turnaround thesis
- Upcoming catalyst in next 6 months OR underappreciated structural tailwind
- Traded on US or Canadian exchanges; liquid enough to trade
- NOT already a widely-covered mega-cap (avoid NVDA, AAPL, MSFT, GOOGL, AMZN, META, TSLA)
${sectorClause}
${excludeClause}

For EACH candidate, provide:
1. Ticker + company name + sector
2. Current price (use web_search for fresh quote) and approximate market cap
3. Bull case (2-3 sentences referencing specific numbers — revenue growth, margins, addressable market)
4. Kill thesis (1-2 sentences — what specific outcome would prove the bull case wrong?)
5. Price target (specific number) and horizon (months)
6. Conviction: low | medium | high
7. 2-3 catalysts to watch

Output STRICT JSON — array of ${topN} objects matching this schema:
{
  "candidates": [
    {
      "ticker": "ABCD",
      "name": "Company Name",
      "sector": "Technology",
      "industry": "Software",
      "exchange": "NASDAQ",
      "currentPrice": 12.34,
      "marketCap": 800000000,
      "thesis": {
        "bullCase": "...",
        "killThesis": "...",
        "priceTarget": 30,
        "horizonMonths": 24,
        "conviction": "medium",
        "catalysts": ["Q3 earnings Oct 28", "FDA decision Nov 15"]
      },
      "signals": {
        "revenueGrowthPct": 45,
        "grossMarginPct": 62
      }
    }
  ]
}

Return ONLY that JSON object. No prose before or after.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-5",
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
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

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { candidates: [], sources };
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return { candidates: [], sources }; }
  return { candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [], sources };
}

// Persist AI-only candidates with the same shape as FMP-screened ones,
// so the rest of the UI doesn't care which path produced them.
async function saveAiOnlyCandidates({ email, candidates, sharedSources, excludeSet }) {
  const scanDate = new Date();
  const saved = [];
  for (const c of candidates) {
    const ticker = String(c.ticker || "").toUpperCase().replace(/\.+$/, "").trim();
    if (!ticker) continue;
    if (excludeSet.has(ticker)) continue;
    try {
      // Score the candidate using whatever signals the AI surfaced. Less
      // accurate than the FMP-driven path (which has full TTM ratios + cash)
      // but gives the UI a real number instead of a misleading 0/100.
      const aiFundamentals = {
        revenueGrowthPct: c?.signals?.revenueGrowthPct ?? null,
        grossMarginPct: c?.signals?.grossMarginPct ?? null,
        operatingMarginPct: c?.signals?.operatingMarginPct ?? null,
        operatingIncomeGrowthPct: c?.signals?.operatingIncomeGrowthPct ?? null,
        netDebtToEquity: c?.signals?.netDebtToEquity ?? null,
        cashAndShortTermInvestments: c?.signals?.cashAndShortTermInvestments ?? null,
      };
      const aiUniverseRow = { marketCap: c.marketCap, beta: c?.signals?.beta };
      const aiScore = scoreCandidate(aiUniverseRow, aiFundamentals);
      const doc = await StocksDiscoveryCandidate.findOneAndUpdate(
        { email: email.toLowerCase(), ticker, scanDate },
        {
          $set: {
            email: email.toLowerCase(),
            ticker,
            name: c.name || "",
            sector: c.sector || "",
            industry: c.industry || "",
            exchange: c.exchange || "",
            marketCap: typeof c.marketCap === "number" ? c.marketCap : null,
            priceAtDiscovery: typeof c.currentPrice === "number" ? c.currentPrice : null,
            currencyAtDiscovery: (c.exchange === "TSX" || c.exchange === "TSXV") ? "CAD" : "USD",
            score: aiScore,
            signals: {
              revenueGrowthPct: c?.signals?.revenueGrowthPct ?? null,
              grossMarginPct: c?.signals?.grossMarginPct ?? null,
              operatingMarginPct: c?.signals?.operatingMarginPct ?? null,
              netDebtToEquity: c?.signals?.netDebtToEquity ?? null,
            },
            thesis: {
              bullCase: c?.thesis?.bullCase || "",
              killThesis: c?.thesis?.killThesis || "",
              priceTarget: typeof c?.thesis?.priceTarget === "number" ? c.thesis.priceTarget : null,
              horizonMonths: typeof c?.thesis?.horizonMonths === "number" ? c.thesis.horizonMonths : 12,
              conviction: ["low", "medium", "high"].includes(c?.thesis?.conviction) ? c.thesis.conviction : "medium",
              catalysts: Array.isArray(c?.thesis?.catalysts) ? c.thesis.catalysts.slice(0, 6) : [],
              sources: sharedSources || [],
            },
            scanDate,
            lastPriceCheckedAt: scanDate,
            lastPrice: typeof c.currentPrice === "number" ? c.currentPrice : null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      saved.push(doc.toObject());
    } catch (e) {
      console.warn("[discovery-ai-only] save failed:", e?.message);
    }
  }
  return { candidates: saved, scanDate };
}

// ─── Public orchestrator ───────────────────────────────────────────────
// Pulls universe, scores, picks top N, writes thesis for each, saves to DB.
//
// If FMP returns 403 (plan doesn't include screener), automatically falls
// back to the AI-only path so the user gets candidates without paying for
// FMP Starter. The response includes a `mode` field ("fmp-screened" or
// "ai-only") plus an `upgradeRecommendation` string the UI can show.
export async function runDiscoveryScan({ email, excludeTickers = [], sectors = null, topN = 8, opts = {} }) {
  const excl = new Set((excludeTickers || []).map((t) => String(t).toUpperCase()));
  // Pull recently-dismissed candidates so we don't keep re-surfacing them
  const recentlyDismissed = await StocksDiscoveryCandidate.find({
    email: email.toLowerCase(),
    dismissed: true,
    scanDate: { $gte: new Date(Date.now() - 60 * 86400 * 1000) },
  }).select("ticker").lean();
  recentlyDismissed.forEach((d) => excl.add(d.ticker));

  // 1. Pull a wide universe — if FMP 403s, fall back to AI-only path.
  let universe;
  try {
    universe = await runUniverseScreen({ sectors, ...opts });
  } catch (e) {
    if (e instanceof FMPPlanInsufficientError) {
      console.log("[discovery] FMP screener 403 — falling back to AI-only prospector");
      const aiResult = await aiOnlyProspect({
        email, excludeTickers: Array.from(excl), sectors, topN,
        marketCapMin: opts.marketCapMin, marketCapMax: opts.marketCapMax,
      });
      const saved = await saveAiOnlyCandidates({
        email,
        candidates: aiResult.candidates,
        sharedSources: aiResult.sources,
        excludeSet: excl,
      });
      return {
        candidates: saved.candidates,
        scanDate: saved.scanDate,
        mode: "ai-only",
        upgradeRecommendation: "Your FMP plan doesn't include the stock-screener endpoint (returned 403). Discovery fell back to AI-only mode, which finds well-known names via web search. For a more rigorous screen over 80+ small-caps with fundamentals filtering, upgrade to FMP Starter ($14/mo) at financialmodelingprep.com/developer/docs — the same FMP_API_KEY env var will start working with the full screener immediately.",
      };
    }
    throw e;
  }
  if (universe.length === 0) {
    return { candidates: [], universeSize: 0, mode: "fmp-screened", error: "Empty universe from FMP screener" };
  }
  if (universe.length === 0) {
    return { candidates: [], universeSize: 0, mode: "fmp-screened", error: "Empty universe from FMP screener" };
  }

  // 2. Filter out names the user already holds OR has previously dismissed
  // (excl Set was built at the top of this function)
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

  // 5. AI thesis writer — throttled to 2 in parallel with retry-on-429.
  // Anthropic's input-token rate limit (default 30K/min) caps how many
  // thesis calls can fire simultaneously; bursting 8 in parallel exceeds
  // that. Throttling to 2 keeps per-minute usage at ~8K tokens which is
  // safely under the ceiling.
  const scanDate = new Date();
  const results = await mapWithThrottle(topCandidates, async (c) => {
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
    const thesis = await writeCandidateThesis(thesisPayload);
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
  }, { concurrency: 2, maxRetries: 2 });

  const candidates = results.filter(Boolean);

  return {
    candidates,
    universeSize: universe.length,
    scoredCount: withFundamentals.length,
    scanDate,
    mode: "fmp-screened",
  };
}
