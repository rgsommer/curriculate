// backend/services/stocksDiscoveryService.js
import { isFmpEnabled, fmpDisabledReason } from "./fmpEnabled.js";
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
import {
  computeDeterministicFactors,
  weightsFor,
  blendScore,
  computeConfidence,
  deriveRiskRating,
  deriveProjection,
  deterministicComposite,
  fetchYahooDaily,
} from "./stocksDiscoveryScore.js";
import { runMosaicBatch, mosaicMode as getMosaicMode, MOSAIC_DISCLAIMER } from "./stocksMosaic.js";
import { assessMoonshot, buildMoonshotResult, syntheticInsiderScore, MOONSHOT_DISCLAIMER } from "./stocksMoonshot.js";
import { getInsiderEdgarSignal } from "./stocksInsiderEdgar.js";
import { compareTranscriptsQoQ } from "./stocksEarningsTranscripts.js";
import { getPatentsSignal } from "./stocksPatentsUspto.js";
import { verifyPicksBatch } from "./stocksAdversarialVerify.js";
import { getChartVisionAnalysis } from "./stocksChartVision.js";
import { computeLessons } from "./stocksLessonsLearned.js";
import { getApprovedTickers } from "./stocksThemesService.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";

const FMP_BASE = "https://financialmodelingprep.com";
const SCREENER_CACHE = new Map(); // key → { fetchedAt, data }
const SCREENER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FUNDAMENTALS_CACHE = new Map(); // ticker → { fetchedAt, data }
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// FMP 403 signal. A 403 does NOT necessarily mean "plan too low" — on a valid
// (even Premium) key it most often means the legacy /api/v3 endpoint is no
// longer served for that key and you must use the /stable API, or the key is
// wrong. We capture FMP's actual response body so the real reason is visible
// instead of guessed.
export class FMPPlanInsufficientError extends Error {
  constructor(path, status, body = "") {
    super(`FMP ${status} on ${path}${body ? ` — ${String(body).slice(0, 200)}` : ""}`);
    this.name = "FMPPlanInsufficientError";
    this.status = status;
    this.path = path;
    this.body = String(body || "");
  }
}

// Translate a legacy /api/v3 path to its /stable equivalent. FMP's stable API
// moved the symbol from the path into a ?symbol= query param and renamed the
// screener. Returns null if we don't know the mapping.
function toStablePath(path) {
  if (path.startsWith("/api/v3/stock-screener")) {
    return path.replace("/api/v3/stock-screener", "/stable/company-screener");
  }
  const m = path.match(/^\/api\/v3\/([^/]+)\/([^/?]+)(\?.*)?$/);
  if (m) {
    const [, endpoint, symbol, query] = m;
    const q = query ? query.slice(1) : "";
    return `/stable/${endpoint}?symbol=${encodeURIComponent(symbol)}${q ? "&" + q : ""}`;
  }
  return null;
}

async function fmpFetchRaw(path) {
  const key = process.env.FMP_API_KEY;
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = await r.text().catch(() => "");
    return { status: r.status, ok: r.ok, body };
  } finally {
    clearTimeout(tid);
  }
}

async function fmpGet(path) {
  if (!isFmpEnabled()) {
    const err = new Error("FMP is disabled (no key or kill-switch on)");
    err.fmpDisabled = true;
    err.reason = fmpDisabledReason() || "fmp_disabled";
    throw err;
  }
  if (!process.env.FMP_API_KEY) throw new Error("FMP_API_KEY not configured");
  let res = await fmpFetchRaw(path);
  // Auto-migrate: a 403 or "legacy endpoint" message on /api/v3 with a valid
  // key usually just means "use /stable". Retry the stable equivalent once.
  // If stable works we transparently fix it; if not, we fall through and
  // report the real error (which the AI-only path then catches).
  if ((res.status === 403 || /legacy|deprecated|stable/i.test(res.body)) && path.startsWith("/api/v3/")) {
    const stable = toStablePath(path);
    if (stable) {
      const alt = await fmpFetchRaw(stable);
      if (alt.ok) { try { return JSON.parse(alt.body); } catch { return []; } }
      if (alt.status === 403) res = alt; // report the stable 403 (more accurate)
    }
  }
  if (res.status === 403) throw new FMPPlanInsufficientError(path, 403, res.body);
  if (!res.ok) throw new Error(`FMP ${res.status}: ${String(res.body).slice(0, 160)}`);
  try { return JSON.parse(res.body); } catch { return []; }
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

  // Screen US AND Canadian listings (override via opts.exchanges).
  const exchanges = opts.exchanges || "NASDAQ,NYSE,AMEX,TSX,TSXV";
  const key = JSON.stringify({ marketCapMin, marketCapMax, priceMin, volumeMin, sectors, limit, exchanges });
  const cached = SCREENER_CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < SCREENER_TTL_MS) return cached.data;

  const buildParams = () => {
    const p = new URLSearchParams({
      marketCapMoreThan: String(marketCapMin),
      marketCapLowerThan: String(marketCapMax),
      priceMoreThan: String(priceMin),
      volumeMoreThan: String(volumeMin),
      isEtf: "false",
      isActivelyTrading: "true",
      limit: String(limit),
    });
    if (Array.isArray(sectors) && sectors.length > 0) p.append("sector", sectors.join(","));
    return p;
  };

  const params = buildParams();
  if (exchanges) params.append("exchange", exchanges);
  let data = await fmpGet(`/api/v3/stock-screener?${params.toString()}`);
  let universe = Array.isArray(data) ? data : [];

  // Some FMP tiers/keys don't honor the exchange filter — if the filtered
  // screen came back empty, retry without it so we never regress to nothing.
  if (universe.length === 0 && exchanges) {
    const data2 = await fmpGet(`/api/v3/stock-screener?${buildParams().toString()}`);
    universe = Array.isArray(data2) ? data2 : [];
  }

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
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-6",
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
async function aiOnlyProspect({ email, excludeTickers, sectors, topN, marketCapMin, marketCapMax, market = "both" }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

  const minM = marketCapMin ? `$${(marketCapMin / 1_000_000).toFixed(0)}M` : "$200M";
  const maxM = marketCapMax ? `$${(marketCapMax / 1_000_000).toFixed(0)}M` : "$5B";
  const marketClause = market === "us"
    ? "- ONLY US-listed names (NASDAQ / NYSE / AMEX). Do not return Canadian or other listings."
    : market === "canada"
    ? "- ONLY Canadian-listed names (TSX / TSXV). Report tickers with their Canadian suffix (e.g. SHOP.TO). Do not return US listings."
    : "- Cover BOTH US (NASDAQ/NYSE/AMEX) AND Canadian (TSX/TSXV) listings — actively surface qualifying Canadian names, don't default to US-only. Aim for a mix when both have strong setups.";
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
${marketClause}
- For each name, report the EXACT exchange and the listing the user would actually trade (e.g. a TSX name as "SHOP.TO" with exchange "TSX"); liquid enough to trade
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
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-6",
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
  // Normalize to UTC midnight so the {email,ticker,scanDate} unique index
  // actually enforces "one candidate per day" — a millisecond-precise
  // timestamp would let two same-day scans create duplicate rows.
  const scanDate = new Date();
  scanDate.setUTCHours(0, 0, 0, 0);
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
// Kill-switch thresholds mirror the daily-pick engine (see
// stocksDailyPickEngine.js). Same rationale: don't keep piling new
// SPEC-sleeve candidates into the pool while the last 30 days show
// the discretionary engine is destroying capital. Silent empty
// return; the caller (briefing) reads it as "no discovery pool today".
const KILL_MIN_HIT_RATE_PCT = 40;
const KILL_MIN_AVG_PNL_PCT = -1.5;
const KILL_MIN_SAMPLE_SIZE = 5;
async function shouldSuppressDiscovery(email) {
  try {
    const lessons = await computeLessons(email);
    const t30 = lessons?.trend?.["30d"];
    if (!t30 || t30.total < KILL_MIN_SAMPLE_SIZE) return { suppress: false, reason: `sample too small (${t30?.total || 0})` };
    if (t30.hitRate < KILL_MIN_HIT_RATE_PCT) return { suppress: true, reason: `30d hit rate ${t30.hitRate.toFixed(0)}% < ${KILL_MIN_HIT_RATE_PCT}% floor` };
    if (t30.avgPnl < KILL_MIN_AVG_PNL_PCT) return { suppress: true, reason: `30d avg PnL ${t30.avgPnl.toFixed(1)}% < ${KILL_MIN_AVG_PNL_PCT}% floor` };
    return { suppress: false, reason: `30d ${t30.wins}/${t30.total} = ${t30.hitRate.toFixed(0)}%, avg ${t30.avgPnl.toFixed(1)}%` };
  } catch (e) {
    console.warn("[discovery-kill-switch] lessons compute failed:", e?.message);
    return { suppress: false, reason: `lessons unavailable (${e?.message})` };
  }
}

export async function runDiscoveryScan({ email, excludeTickers = [], sectors = null, topN = 8, opts = {} }) {
  // Kill-switch gate. Same rationale as generateDailyPicksForUser —
  // stop feeding new SPEC candidates when the discretionary engine is
  // demonstrably losing money. Returns an empty scan (0 candidates)
  // rather than throwing, so the briefing shows "no discovery pool
  // today" cleanly.
  const gate = await shouldSuppressDiscovery(email);
  if (gate.suppress) {
    console.warn(`[discovery-kill-switch] SUPPRESSED for ${email}: ${gate.reason}`);
    return { candidates: [], mode: "suppressed", suppressReason: gate.reason };
  }
  console.log(`[discovery-kill-switch] pass for ${email}: ${gate.reason}`);
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
  let filtered = universe.filter((u) => !excl.has(String(u.symbol || "").toUpperCase()));

  // 2b. Theme-first gate for SPEC-classified candidates. Per user
  // Aug 5 overhaul §3: a chart-pattern setup can no longer generate
  // a SPEC discovery pick on its own — the ticker must be a member
  // of at least one enabled structural theme. CORE/SWING/INCOME
  // names pass through untouched.
  const approvedThemeTickers = await getApprovedTickers(email);
  const beforeThemeCount = filtered.length;
  filtered = filtered.filter((u) => {
    const sym = String(u.symbol || "").toUpperCase();
    if (!sym) return false;
    const sleeve = classifyPosition({ ticker: sym });
    if (sleeve !== "spec") return true; // non-SPEC untouched
    const base = sym.replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
    return approvedThemeTickers.has(base);
  });
  const droppedByTheme = beforeThemeCount - filtered.length;
  if (droppedByTheme > 0) {
    console.log(`[discovery-theme-gate] dropped ${droppedByTheme} SPEC candidates not in any enabled theme (kept ${filtered.length}/${beforeThemeCount})`);
  }

  // 3. Fetch fundamentals for a pre-rank slice. To keep cost manageable,
  // limit to top ~80 by market cap × volume liquidity proxy before doing
  // the per-ticker FMP fundamentals calls (each ~3 API hits).
  const preRanked = filtered
    .map((u) => ({ ...u, _proxy: (Number(u.marketCap) || 0) * Math.log10((Number(u.volume) || 0) + 1) }))
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
  // UTC midnight so the per-day unique index dedupes same-day re-scans.
  const scanDate = new Date();
  scanDate.setUTCHours(0, 0, 0, 0);
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
    // Upsert keyed on (email, ticker, scanDate) — usually a fresh insert.
    // Also append to scoreHistory so the ConvictionTrendBadge on the
    // DiscoverTab card can render rising/falling/stable vs prior scans
    // (previously only high-conviction + moonshot scans appended).
    const saved = await StocksDiscoveryCandidate.findOneAndUpdate(
      { email: doc.email, ticker: doc.ticker, scanDate: doc.scanDate },
      {
        $set: doc,
        $push: { scoreHistory: { $each: [{ date: scanDate, score: doc.score, source: "discovery" }], $slice: -90 } },
      },
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

// ═══════════════════════════════════════════════════════════════════════
// HIGH-CONVICTION MULTI-FACTOR SCREEN (additive — does not touch the legacy
// scan above). Builds a shortlist, scores 4 modules deterministically
// (stocksDiscoveryScore.js), then a single AI/web_search call assesses
// catalysts + sentiment + narrative-shift and writes the qualitative output.
// The final 0-100 is blended in code from all six modules × risk-mode weights,
// so it stays transparent. Returns only the top 2-3 with a hard disclaimer.
// ═══════════════════════════════════════════════════════════════════════

export const HIGH_CONVICTION_DISCLAIMER =
  "This is not financial advice. These are high-conviction screening results based on available data and may be wrong.";

// Build a ~6-name shortlist to run the expensive analysis on. Reuses the FMP
// Market scope helpers (US / Canada / both).
function exchangesForMarket(market) {
  if (market === "us") return "NASDAQ,NYSE,AMEX";
  if (market === "canada") return "TSX,TSXV";
  return "NASDAQ,NYSE,AMEX,TSX,TSXV"; // both / default
}
function candidateMarket(c) {
  const ex = String(c.exchange || c.exchangeShortName || "").toUpperCase();
  const ccy = c.currency || c.currencyAtDiscovery;
  const tk = String(c.ticker || c.symbol || "");
  if (ccy === "CAD" || /^(TSX|TSXV|CN|NEO|NE)$/.test(ex) || /\.(TO|V|NE|CN)$/i.test(tk)) return "CA";
  return "US";
}
function matchesMarket(c, market) {
  if (!market || market === "both") return true;
  return candidateMarket(c) === (market === "us" ? "US" : "CA");
}

// screen + composite score; falls back to the AI prospector on FMP 403.
async function buildShortlist({ email, sectors, opts, excl, shortlistN, market = "both" }) {
  try {
    const universe = await runUniverseScreen({ sectors, exchanges: exchangesForMarket(market), ...opts });
    const filtered = (universe || []).filter((u) =>
      !excl.has(String(u.symbol || "").toUpperCase()) && matchesMarket(u, market)
    );
    const preRanked = filtered
      .map((u) => ({ ...u, _proxy: (Number(u.marketCap) || 0) * Math.log10((Number(u.volume) || 0) + 1) }))
      .sort((a, b) => b._proxy - a._proxy)
      .slice(0, 60);
    const withFundamentals = await Promise.all(
      preRanked.map(async (u) => {
        const fundamentals = await fetchCandidateFundamentals(u.symbol);
        return { ...u, fundamentals, _score: scoreCandidate(u, fundamentals) };
      })
    );
    const top = withFundamentals
      .filter((c) => c._score > 20)
      .sort((a, b) => b._score - a._score)
      .slice(0, shortlistN)
      .map((c) => ({
        ticker: String(c.symbol).toUpperCase(),
        name: c.companyName || c.name || "",
        sector: c.sector || "",
        industry: c.industry || "",
        exchange: c.exchangeShortName || "",
        marketCap: c.marketCap ?? null,
        price: c.price ?? null,
        currency: (c.exchangeShortName === "TSX" || c.exchangeShortName === "TSXV") ? "CAD" : "USD",
        fundamentals: c.fundamentals,
      }));
    return { shortlist: top, mode: "fmp-screened", upgradeRecommendation: null };
  } catch (e) {
    if (!(e instanceof FMPPlanInsufficientError)) throw e;
    // FMP screener unavailable — let the AI surface candidate tickers, then we
    // still score them deterministically off Yahoo (technicals/returns work
    // without FMP).
    const ai = await aiOnlyProspect({ email, excludeTickers: Array.from(excl), sectors, topN: shortlistN, marketCapMin: opts.marketCapMin, marketCapMax: opts.marketCapMax, market });
    const shortlist = (ai.candidates || []).map((c) => ({
      ticker: String(c.ticker || "").toUpperCase().replace(/\.+$/, ""),
      name: c.name || "",
      sector: c.sector || "",
      industry: c.industry || "",
      exchange: c.exchange || "",
      marketCap: typeof c.marketCap === "number" ? c.marketCap : null,
      price: typeof c.currentPrice === "number" ? c.currentPrice : null,
      currency: (c.exchange === "TSX" || c.exchange === "TSXV") ? "CAD" : "USD",
      fundamentals: {
        revenueGrowthPct: c?.signals?.revenueGrowthPct ?? null,
        grossMarginPct: c?.signals?.grossMarginPct ?? null,
        operatingIncomeGrowthPct: c?.signals?.operatingIncomeGrowthPct ?? null,
        netDebtToEquity: c?.signals?.netDebtToEquity ?? null,
      },
    })).filter((c) => c.ticker && matchesMarket(c, market));
    const reason = e?.body ? ` FMP said: "${String(e.body).slice(0, 180)}".` : "";
    return {
      shortlist,
      mode: "ai-only",
      upgradeRecommendation: `FMP screener returned 403 even after trying the /stable API.${reason} On a Premium plan this usually means the FMP_API_KEY deployed on the server isn't your Premium key, or that key isn't provisioned for the screener endpoint — verify the key in the backend env. Shortlist came from AI web search; technical/momentum scores are still live from Yahoo.`,
    };
  }
}

// Shared-universe alternative to buildShortlist. Instead of running a
// fresh FMP screener, this reads the caller's existing Discover pool
// (StocksDiscoveryCandidate docs) and shapes each into the same
// `{ticker, name, sector, ..., fundamentals}` structure the downstream
// pipeline (computeDeterministicFactors → AI select → mosaic → verify)
// expects. Same output contract as buildShortlist so callers can
// swap between "screener" and "pool" without touching downstream code.
//
// Effect for the operator: High-Conviction and Moonshot score the
// exact set of names the Discover engine already surfaced — the
// three lists converge on one core universe instead of running three
// independent screeners against the whole market.
//
// Filters applied at the pool layer (in priority order):
//   1. exclude previously-dismissed and non-latest scan dates
//   2. exclude caller's held tickers (excl set — matches buildShortlist)
//   3. sector filter if requested
//   4. market filter (US / Canada / both — matches buildShortlist)
//   5. sort by score desc, take top `shortlistN`
//   6. always keep starred docs (carryover) even if scanDate isn't latest
async function buildShortlistFromDiscoverPool({ email, sectors, opts, excl, shortlistN, market = "both" }) {
  const marketCapMin = opts?.marketCapMin ?? 0;
  const marketCapMax = opts?.marketCapMax ?? Infinity;
  const wantedSectors = (Array.isArray(sectors) && sectors.length > 0)
    ? new Set(sectors.map(s => String(s).toLowerCase()))
    : null;

  // Load latest-scanDate docs + starred carryover. Same query family
  // as GET /candidates so the input universe matches what the operator
  // sees on the Discover tab.
  const latestDoc = await StocksDiscoveryCandidate.findOne({ email, dismissed: { $ne: true } })
    .sort({ scanDate: -1 })
    .select("scanDate")
    .lean();
  const latestScanDate = latestDoc?.scanDate || null;
  const query = { email, dismissed: { $ne: true } };
  if (latestScanDate) {
    query.$or = [{ scanDate: latestScanDate }, { starred: true }];
  }
  const poolDocs = await StocksDiscoveryCandidate.find(query).lean();

  const preFiltered = poolDocs
    .filter(d => d.ticker)
    .filter(d => !excl.has(String(d.ticker).toUpperCase()))
    .filter(d => {
      if (!wantedSectors) return true;
      return wantedSectors.has(String(d.sector || "").toLowerCase());
    })
    .filter(d => {
      const cap = Number(d.marketCap);
      if (!Number.isFinite(cap)) return true; // don't drop for missing cap
      return cap >= marketCapMin && cap <= marketCapMax;
    })
    .filter(d => matchesMarket({ exchangeShortName: d.exchange, symbol: d.ticker }, market));

  if (preFiltered.length === 0) {
    return {
      shortlist: [],
      mode: "pool-empty",
      upgradeRecommendation: `Discover pool is empty (or every candidate was filtered out by market/sector/cap). Run a fresh Discover scan first, or switch source back to "screener" to run against the broader FMP universe.`,
    };
  }

  const top = preFiltered
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, shortlistN)
    .map(d => ({
      ticker: String(d.ticker).toUpperCase(),
      name: d.name || "",
      sector: d.sector || "",
      industry: d.industry || "",
      exchange: d.exchange || "",
      marketCap: d.marketCap ?? null,
      price: d.priceAtDiscovery ?? null,
      currency: d.currencyAtDiscovery || ((d.exchange === "TSX" || d.exchange === "TSXV") ? "CAD" : "USD"),
      // Reconstruct the fundamentals shape from the signals field so
      // downstream scoring works unchanged. Discover stores richer
      // signals; we surface the subset buildShortlist emits.
      fundamentals: {
        revenueGrowthPct: d?.signals?.revenueGrowthPct ?? null,
        grossMarginPct: d?.signals?.grossMarginPct ?? null,
        operatingIncomeGrowthPct: d?.signals?.operatingIncomeGrowthPct ?? null,
        netDebtToEquity: d?.signals?.netDebtToEquity ?? null,
        freeCashFlowYieldPct: d?.signals?.freeCashFlowYieldPct ?? null,
        psTTM: d?.signals?.psTTM ?? null,
      },
      _fromDiscoverPool: true,
      _discoverScore: d.score ?? null,
      _discoverConviction: d.thesis?.conviction ?? null,
      _starred: !!d.starred,
    }));

  return {
    shortlist: top,
    mode: "discover-pool",
    upgradeRecommendation: null,
  };
}

// Single AI call: score catalysts + sentiment + narrative for the whole
// shortlist and write the qualitative analysis, then pick + order the top 2-3.
async function scoreCandidatesWithAI(candidatesForAI, riskMode, topN) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for high-conviction screen");

  const lines = candidatesForAI.map((c, i) => {
    const s = c.sub;
    const detSummary = ["fundamentals", "momentum", "technical", "riskControl"]
      .map((k) => `${k}=${s[k]?.score ?? "n/a"}`).join(", ");
    const keyFacts = (c.raw?.fundamentals || {});
    return `[#${i + 1}] ${c.ticker} — ${c.name || "?"} (${c.sector || "?"}), ~$${c.marketCap ? (c.marketCap / 1e9).toFixed(2) + "B" : "?"} cap, price ${c.price != null ? "$" + c.price : "?"} ${c.currency}
   deterministic sub-scores: ${detSummary}
   rev growth ${keyFacts.revenueGrowthPct?.toFixed?.(0) ?? "?"}%, gross margin ${keyFacts.grossMarginPct?.toFixed?.(0) ?? "?"}%, FCF yield ${keyFacts.freeCashFlowYieldPct?.toFixed?.(1) ?? "?"}%, D/E ${keyFacts.netDebtToEquity?.toFixed?.(2) ?? "?"}, P/S ${keyFacts.psTTM?.toFixed?.(1) ?? "?"}
   12mo/6mo/3mo return: ${c.raw?.returns?.r12m?.toFixed?.(0) ?? "?"}% / ${c.raw?.returns?.r6m?.toFixed?.(0) ?? "?"}% / ${c.raw?.returns?.r3m?.toFixed?.(0) ?? "?"}%, RSI ${c.raw?.tech?.rsi14?.toFixed?.(0) ?? "?"}`;
  }).join("\n\n");

  const prompt = `You are a skeptical buy-side analyst running a multi-factor high-conviction screen in "${riskMode}" risk mode. You are given ${candidatesForAI.length} pre-screened candidates with deterministic fundamentals/momentum/technical/risk sub-scores already computed (0-100). Your job is to add the two evidence layers the code can't compute, then select the strongest 2-3.

CANDIDATES:
${lines}

For EACH candidate, use web_search to assess:
- CATALYSTS (next ~6 months): earnings date, recent guidance changes, product launches, FDA decisions (if biotech), M&A rumours/news, regulatory events, major contracts, short-interest changes, unusual options activity.
- SENTIMENT: news tone, analyst rating/target changes, social/media buzz, product/customer review trends, management credibility. **Heavily penalize hype that is NOT backed by improving fundamentals** — set hypePenaltyApplied=true and a low sentiment score when the story is narrative-only.
- NARRATIVE SHIFT: accelerating mentions of AI/defence/energy/fintech/crypto/biotech/infrastructure in recent filings/transcripts vs prior quarters; mismatch between improving fundamentals and lagging price; mismatch between negative sentiment and a strong balance sheet.

Scoring rules:
- catalystScore and sentimentScore are 0-100 EVIDENCE STRENGTH, not certainty.
- A name whose thesis depends ONLY on hype, OR has heavy dilution / weak balance sheet / collapsing revenue / no clear catalyst, must score low and may be dropped from the top picks entirely.
- Prefer asymmetric risk/reward and the strongest evidence cluster across MULTIPLE independent lenses, not a single signal.

LANGUAGE: never use "guaranteed", "sure thing", or "can't lose". Use "highest-conviction", "asymmetric risk/reward", "probability-weighted upside", "strongest evidence cluster", "watchlist candidate".

Return STRICT JSON only:
{
  "picks": [
    {
      "ticker": "ABCD",
      "catalystScore": <0-100>,
      "sentimentScore": <0-100>,
      "catalystContributors": ["specific catalyst with date if known", "..."],
      "sentimentContributors": ["analyst/news/sentiment evidence", "..."],
      "keyCatalysts": ["bullet", "bullet"],
      "bullCase": "2-3 sentences, cite specific numbers/evidence",
      "bearCase": "2-3 sentences, the real downside / what bears see",
      "whatProvesWrong": "1-2 sentences — the specific outcome that invalidates the thesis",
      "whyBeatOthers": "1-2 sentences — why this cleared the bar over the other candidates",
      "suggestedWatchZone": "price zone to watch/accumulate, native currency",
      "stopLevel": "invalidation / stop-loss level, native currency",
      "timeHorizon": "short-term" | "medium-term" | "long-term",
      "hypePenaltyApplied": true | false,
      "riskRatingHint": "Low" | "Medium" | "High" | "Speculative",
      "sources": [{"title":"...","url":"..."}]
    }
  ]
}
Return the ${topN} STRONGEST candidates only, ordered best-first. If fewer than ${topN} clear a genuine high-conviction bar, return fewer — do not pad. No prose outside the JSON.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, parseInt(process.env.STOCKS_DISCOVERY_MAX_SEARCHES, 10) || 10) }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${err.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { picks: [] };
  try { return JSON.parse(m[0]); } catch { return { picks: [] }; }
}

export async function runHighConvictionScan({ email, riskMode = "balanced", sectors = null, topN = 3, opts = {}, includeMosaic = false, mosaicMode = "balanced", market = "both", source = "screener" }) {
  const mode = ["conservative", "balanced", "aggressive", "speculative"].includes(riskMode) ? riskMode : "balanced";
  const mMode = ["conservative", "balanced", "aggressive"].includes(mosaicMode) ? mosaicMode : "balanced";
  const mkt = ["both", "us", "canada"].includes(market) ? market : "both";
  const weights = weightsFor(mode);
  const shortlistN = 6;

  // Exclude held + recently dismissed
  const excl = new Set();
  const recentlyDismissed = await StocksDiscoveryCandidate.find({
    email: email.toLowerCase(), dismissed: true,
    scanDate: { $gte: new Date(Date.now() - 60 * 86400 * 1000) },
  }).select("ticker").lean();
  recentlyDismissed.forEach((d) => excl.add(d.ticker));
  (opts.excludeTickers || []).forEach((t) => excl.add(String(t).toUpperCase()));

  // Shared-universe: when source="pool", use the caller's Discover
  // pool docs instead of running a fresh FMP screener. Same output
  // contract so the downstream pipeline (deterministic factors → AI
  // catalyst/sentiment → mosaic → verify → chart) works unchanged.
  const shortlistFn = source === "pool" ? buildShortlistFromDiscoverPool : buildShortlist;
  const { shortlist, mode: scanMode, upgradeRecommendation } = await shortlistFn({ email, sectors, opts, excl, shortlistN, market: mkt });
  if (!shortlist.length) {
    return { picks: [], riskMode: mode, mode: scanMode, upgradeRecommendation, disclaimer: HIGH_CONVICTION_DISCLAIMER, error: source === "pool" ? "Discover pool is empty — run a fresh Discover scan first or switch source to screener." : "No candidates cleared the pre-screen." };
  }

  // Deterministic factors (parallel) — one shared SPY history for rel-strength
  const spyPoints = await fetchYahooDaily("SPY", "1y").catch(() => null);
  const withFactors = await Promise.all(shortlist.map(async (c) => {
    const { sub, raw } = await computeDeterministicFactors({
      ticker: c.ticker, currency: c.currency, marketCap: c.marketCap, fmpFundamentals: c.fundamentals, spyPoints,
    });
    return { ...c, sub, raw };
  }));

  // AI catalyst/sentiment/narrative + top-N selection, plus (optional) the
  // Mosaic Intelligence batch — run in parallel to keep wall time down.
  const mosaicCandidates = withFactors.map((c) => ({ ticker: c.ticker, name: c.name, sector: c.sector, marketCap: c.marketCap, price: c.price, currency: c.currency }));
  const [ai, mosaicByTicker] = await Promise.all([
    scoreCandidatesWithAI(withFactors, mode, topN),
    includeMosaic
      ? runMosaicBatch(mosaicCandidates, mMode).catch((e) => { console.warn("[mosaic] batch failed:", e?.message); return {}; })
      : Promise.resolve({}),
  ]);
  // Match AI picks to the shortlist by NORMALIZED ticker so a suffix/format
  // mismatch (ABC vs ABC.TO) doesn't silently drop a valid pick.
  const byNorm = new Map(withFactors.map((c) => [normTicker(c.ticker), c]));

  // Assemble + blend (top picks the AI returned, in its order)
  const scanDate = new Date();
  scanDate.setUTCHours(0, 0, 0, 0);
  const picks = [];
  for (const p of (ai.picks || [])) {
    const c = byNorm.get(normTicker(p.ticker));
    if (!c) continue;
    const catalysts = { score: clampScore(p.catalystScore), weight: weights.catalysts, contributors: arr(p.catalystContributors) };
    const sentiment = { score: clampScore(p.sentimentScore), weight: weights.sentiment, contributors: arr(p.sentimentContributors) };
    // Attach weights to the deterministic modules too (for display transparency)
    const factors = {
      fundamentals: { ...c.sub.fundamentals, weight: weights.fundamentals },
      momentum: { ...c.sub.momentum, weight: weights.momentum },
      technical: { ...c.sub.technical, weight: weights.technical },
      catalysts,
      sentiment,
      riskControl: { ...c.sub.riskControl, weight: weights.riskControl },
    };
    const subForBlend = {
      fundamentals: factors.fundamentals, momentum: factors.momentum, technical: factors.technical,
      catalysts, sentiment, riskControl: factors.riskControl,
    };
    // Mosaic Edge folds in as a 7th ranking factor when enabled — the base 6
    // weights are scaled down by the mode's rankWeight so the total stays 1.0.
    const mosaic = includeMosaic ? (mosaicByTicker[c.ticker] || null) : null;
    let blendWeights = weights;
    let subForBlendFinal = subForBlend;
    if (mosaic && mosaic.edgeScore != null) {
      const mw = getMosaicMode(mMode).rankWeight;
      blendWeights = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v * (1 - mw)]));
      blendWeights.mosaic = mw;
      subForBlendFinal = { ...subForBlend, mosaic: { score: mosaic.edgeScore } };
    }
    const weightedScore = blendScore(subForBlendFinal, blendWeights);
    const dataFlags = ["fundamentals", "momentum", "technical", "riskControl"]
      .flatMap((k) => (c.sub[k]?.flags || []).map((f) => `${k}: ${f}`));
    const confidence = computeConfidence(subForBlend, dataFlags.length);
    let riskRating = deriveRiskRating(c.sub.riskControl?.score, c.raw?.tech, c.marketCap);
    if (p.hypePenaltyApplied || p.riskRatingHint === "Speculative") riskRating = "Speculative";
    else if (["Low", "Medium", "High", "Speculative"].includes(p.riskRatingHint) && rank(p.riskRatingHint) > rank(riskRating)) riskRating = p.riskRatingHint;

    const multiFactor = {
      riskMode: mode,
      weightedScore,
      confidence,
      factors,
      riskRating,
      bullCase: str(p.bullCase),
      bearCase: str(p.bearCase),
      keyCatalysts: arr(p.keyCatalysts),
      watchZone: str(p.suggestedWatchZone),
      stopLevel: str(p.stopLevel),
      timeHorizon: ["short-term", "medium-term", "long-term"].includes(p.timeHorizon) ? p.timeHorizon : "medium-term",
      projection: deriveProjection({ tech: c.raw?.tech, price: c.price, riskMode: mode, timeHorizon: ["short-term", "medium-term", "long-term"].includes(p.timeHorizon) ? p.timeHorizon : "medium-term" }),
      whyBeatOthers: str(p.whyBeatOthers),
      whatProvesWrong: str(p.whatProvesWrong),
      hypePenaltyApplied: !!p.hypePenaltyApplied,
      dataFlags,
      sources: arr(p.sources).filter((s) => s && s.url).map((s) => ({ title: s.title || s.url, url: s.url })),
      // Real catalysts from FMP (earnings date + recent analyst actions)
      // so the card can render them next to the AI's narrative.
      catalystsData: c.raw?.catalysts ? {
        nextEarnings: c.raw.catalysts.earnings || null,
        analystSummary: c.raw.catalysts.analystSummary || null,
        recentAnalysts: (c.raw.catalysts.analysts || []).slice(0, 5),
      } : null,
      // Short interest + squeeze setup (Yahoo → FINRA data)
      shortInterestData: c.raw?.shortInterest?.ok ? {
        siPctOfFloat: c.raw.shortInterest.raw.siPctOfFloat,
        dtc: c.raw.shortInterest.raw.dtc,
        momChangePct: c.raw.shortInterest.raw.momChangePct,
        floatShares: c.raw.shortInterest.raw.floatShares,
        reportDate: c.raw.shortInterest.raw.reportDate,
        squeezeScore: c.raw.shortInterest.squeeze?.score ?? null,
        squeezeContributors: c.raw.shortInterest.squeeze?.contributors ?? [],
        setupType: c.raw.shortInterest.setupType,
      } : null,
    };

    // Persist (upsert by email+ticker+day) — score mirrors weightedScore so
    // the legacy list/scorecard still works.
    try {
      const doc = await StocksDiscoveryCandidate.findOneAndUpdate(
        { email: email.toLowerCase(), ticker: c.ticker, scanDate },
        { $set: {
            email: email.toLowerCase(), ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry,
            exchange: c.exchange, marketCap: c.marketCap, priceAtDiscovery: c.price, currencyAtDiscovery: c.currency,
            score: weightedScore ?? 0,
            signals: {
              revenueGrowthPct: c.raw?.fundamentals?.revenueGrowthPct ?? null,
              grossMarginPct: c.raw?.fundamentals?.grossMarginPct ?? null,
              operatingMarginPct: c.raw?.fundamentals?.operatingMarginPct ?? null,
              netDebtToEquity: c.raw?.fundamentals?.netDebtToEquity ?? null,
            },
            thesis: { bullCase: multiFactor.bullCase, killThesis: multiFactor.whatProvesWrong, catalysts: multiFactor.keyCatalysts, conviction: weightedScore >= 75 ? "high" : weightedScore >= 55 ? "medium" : "low", sources: multiFactor.sources },
            multiFactor,
            mosaic: mosaic || null,
            scanDate, lastPriceCheckedAt: scanDate, lastPrice: c.price,
          },
          $push: { scoreHistory: { $each: [{ date: scanDate, score: deterministicComposite(c.sub, mode), source: "highconviction" }], $slice: -90 } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      picks.push(doc.toObject());
    } catch (e) {
      console.warn("[high-conviction] save failed:", e?.message);
    }
  }

  // Adversarial verify: attack every pick with a skeptical short-seller before
  // shipping. Adjusts weightedScore (small penalty for risk_flagged, sharper
  // for reject), attaches .adversarial to each pick for the UI badge. Picks
  // whose bear thesis is stronger than their bull case are dropped entirely.
  try {
    const quantByTicker = {};
    for (const p of picks) {
      const c = withFactors.find((x) => x.ticker === p.ticker);
      if (c) quantByTicker[p.ticker] = { tech: c.raw?.tech, fund: c.raw?.fundamentals };
    }
    const verdicts = await verifyPicksBatch(picks, quantByTicker);
    for (const p of picks) {
      const v = verdicts[p.ticker];
      if (!v || !p.multiFactor) continue;
      p.multiFactor.adversarial = v;
      const base = p.multiFactor.weightedScore ?? 0;
      p.multiFactor.weightedScore = Math.max(0, Math.min(100, base + v.confidenceAdjustment));
      if (p.score != null) p.score = p.multiFactor.weightedScore;
    }
    // Drop picks the adversarial pass rejected outright (bear > bull).
    for (let i = picks.length - 1; i >= 0; i--) {
      if (picks[i].multiFactor?.adversarial?.verdict === "reject") picks.splice(i, 1);
    }
  } catch (e) {
    console.warn("[high-conviction] adversarial verify failed:", e?.message);
  }

  // Chart vision enrichment: render each surviving pick's chart, send to
  // Claude with vision, get pattern/trend-stage/gestalt analysis. One
  // Haiku vision call per pick — cheap enough for a ~5-10 pick scan.
  try {
    await Promise.all(picks.map(async (p) => {
      const cv = await getChartVisionAnalysis(p.ticker, p.currencyAtDiscovery || "USD");
      if (cv && p.multiFactor) p.multiFactor.chartVision = cv;
    }));
  } catch (e) {
    console.warn("[high-conviction] chart vision failed:", e?.message);
  }

  // Folding Mosaic in may reorder the picks — sort by the final blended score.
  picks.sort((a, b) => (b.multiFactor?.weightedScore ?? 0) - (a.multiFactor?.weightedScore ?? 0));

  // If the AI selector returned nothing (common in the thin-data AI-only path,
  // or when it's being strict), don't dead-end. Fall back to ranking the
  // shortlist by HARD DATA ONLY (the 4 deterministic modules) and surface the
  // best as clearly-labelled "below-bar" watchlist candidates — never as
  // confirmed high-conviction picks.
  let belowBar = false;
  if (picks.length === 0) {
    const fb = deterministicFallbackPicks(withFactors, weights, mode, topN);
    picks.push(...fb);
    belowBar = picks.length > 0;
  }

  return {
    picks, riskMode: mode, mode: scanMode, upgradeRecommendation, scanDate,
    disclaimer: HIGH_CONVICTION_DISCLAIMER,
    mosaicEnabled: !!includeMosaic, mosaicMode: includeMosaic ? mMode : null,
    market: mkt,
    belowBar,
    diagnostic: {
      shortlistSize: shortlist.length,
      aiReturned: (ai.picks || []).length,
      note: belowBar
        ? "AI selector returned no high-conviction picks — showing strongest shortlist names by hard data only (catalysts/sentiment not confirmed)."
        : null,
    },
  };
}

// Deterministic-only fallback picks (no catalyst/sentiment) — used when the AI
// selector returns nothing so the user still sees the transparent scoring.
function deterministicFallbackPicks(withFactors, weights, mode, topN) {
  const detWeights = { fundamentals: weights.fundamentals, momentum: weights.momentum, technical: weights.technical, riskControl: weights.riskControl };
  const ranked = withFactors
    .map((c) => {
      const detSub = { fundamentals: c.sub.fundamentals, momentum: c.sub.momentum, technical: c.sub.technical, riskControl: c.sub.riskControl };
      return { c, detScore: blendScore(detSub, detWeights) };
    })
    .filter((x) => x.detScore != null)
    .sort((a, b) => b.detScore - a.detScore)
    .slice(0, topN);

  return ranked.map(({ c, detScore }) => {
    const notAssessed = (w) => ({ score: null, weight: w, contributors: ["Not assessed — below high-conviction bar"] });
    const factors = {
      fundamentals: { ...c.sub.fundamentals, weight: weights.fundamentals },
      momentum: { ...c.sub.momentum, weight: weights.momentum },
      technical: { ...c.sub.technical, weight: weights.technical },
      catalysts: notAssessed(weights.catalysts),
      sentiment: notAssessed(weights.sentiment),
      riskControl: { ...c.sub.riskControl, weight: weights.riskControl },
    };
    const subForConf = {
      fundamentals: factors.fundamentals, momentum: factors.momentum, technical: factors.technical,
      catalysts: factors.catalysts, sentiment: factors.sentiment, riskControl: factors.riskControl,
    };
    const dataFlags = ["fundamentals", "momentum", "technical", "riskControl"]
      .flatMap((k) => (c.sub[k]?.flags || []).map((f) => `${k}: ${f}`));
    dataFlags.push("Catalysts & sentiment not assessed (no AI selection this run)");
    return {
      ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry,
      marketCap: c.marketCap, priceAtDiscovery: c.price, currencyAtDiscovery: c.currency,
      score: detScore,
      belowBar: true,
      multiFactor: {
        riskMode: mode,
        weightedScore: detScore,
        confidence: computeConfidence(subForConf, dataFlags.length),
        factors,
        riskRating: deriveRiskRating(c.sub.riskControl?.score, c.raw?.tech, c.marketCap),
        bullCase: "", bearCase: "", keyCatalysts: [],
        watchZone: "", stopLevel: "", timeHorizon: "medium-term",
        projection: deriveProjection({ tech: c.raw?.tech, price: c.price, riskMode: mode, timeHorizon: "medium-term" }),
        whyBeatOthers: "Ranked on hard data only — no AI high-conviction selection this run.",
        whatProvesWrong: "", hypePenaltyApplied: false,
        dataFlags, sources: [],
      },
    };
  });
}

function normTicker(t) {
  return String(t || "").toUpperCase().replace(/\.+$/, "").replace(/\.(TO|V|NE|CN|US)$/i, "");
}

// ═══════════════════════════════════════════════════════════════════════
// MOONSHOT 10x SCAN (additive) — hunts 2–5 asymmetric high-upside candidates.
// Reuses the shortlist + deterministic factors + Mosaic, adds the pre-parabolic
// / reality-lag / synthetic-insider signals and a focused AI asymmetric-upside
// layer with calibrated P(5x)/P(10x). Smaller-cap, higher-growth bias.
// ═══════════════════════════════════════════════════════════════════════
export async function runMoonshotScan({ email, market = "both", sectors = null, opts = {}, horizon = "long", source = "screener" }) {
  const mkt = ["both", "us", "canada"].includes(market) ? market : "both";
  const hz = horizon === "short" ? "short" : "long";
  // Moonshot bias: skew smaller-cap (more room to compound) unless overridden.
  const moonshotOpts = {
    marketCapMin: typeof opts.marketCapMin === "number" ? opts.marketCapMin : 100_000_000,
    marketCapMax: typeof opts.marketCapMax === "number" ? opts.marketCapMax : 10_000_000_000,
    ...opts,
  };
  const excl = new Set();
  const recentlyDismissed = await StocksDiscoveryCandidate.find({
    email: email.toLowerCase(), dismissed: true,
    scanDate: { $gte: new Date(Date.now() - 60 * 86400 * 1000) },
  }).select("ticker").lean();
  recentlyDismissed.forEach((d) => excl.add(d.ticker));
  (opts.excludeTickers || []).forEach((t) => excl.add(String(t).toUpperCase()));

  const shortlistN = 8;
  // Shared-universe: same swap as HC. source="pool" scores the
  // Discover pool docs; "screener" runs a fresh FMP screener.
  const shortlistFn = source === "pool" ? buildShortlistFromDiscoverPool : buildShortlist;
  const { shortlist, mode: scanMode, upgradeRecommendation } = await shortlistFn({ email, sectors, opts: moonshotOpts, excl, shortlistN, market: mkt });
  if (!shortlist.length) {
    return { picks: [], market: mkt, mode: scanMode, upgradeRecommendation, disclaimer: MOONSHOT_DISCLAIMER, error: "No candidates cleared the pre-screen." };
  }

  // Deterministic factors (+ pre-parabolic / reality-lag) and Mosaic in parallel.
  const spyPoints = await fetchYahooDaily("SPY", "1y").catch(() => null);
  const withFactors = await Promise.all(shortlist.map(async (c) => {
    const det = await computeDeterministicFactors({ ticker: c.ticker, currency: c.currency, marketCap: c.marketCap, fmpFundamentals: c.fundamentals, spyPoints });
    return { ...c, sub: det.sub, raw: det.raw, moonshot: det.moonshot };
  }));
  const mosaicByTicker = await runMosaicBatch(
    withFactors.map((c) => ({ ticker: c.ticker, name: c.name, sector: c.sector, marketCap: c.marketCap, price: c.price, currency: c.currency })),
    "aggressive"
  ).catch((e) => { console.warn("[moonshot] mosaic failed:", e?.message); return {}; });
  for (const c of withFactors) {
    c.mosaic = mosaicByTicker[c.ticker] || null;
    c.syntheticInsider = syntheticInsiderScore(c.mosaic);
  }

  // ── Authoritative alt-data pulls (free public sources) ─────────────
  // EDGAR Form 4, FMP earnings-transcript QoQ NLP, USPTO PatentsView.
  // Each is cached + has graceful failure; passed to assessMoonshot as
  // hard-evidence the model should prefer over web_search guesses.
  await Promise.all(withFactors.map(async (c) => {
    const [insider, transcript, patents] = await Promise.all([
      getInsiderEdgarSignal(c.ticker).catch(() => null),
      compareTranscriptsQoQ(c.ticker).catch(() => null),
      getPatentsSignal(c.ticker, c.name).catch(() => null),
    ]);
    c.altData = { insider, transcript, patents };
  }));

  const ai = await assessMoonshot(withFactors, mkt, hz);
  const byNorm = new Map(withFactors.map((c) => [normTicker(c.ticker), c]));

  const scanDate = new Date();
  scanDate.setUTCHours(0, 0, 0, 0);
  const picks = [];
  let rejectedCount = 0;
  for (const item of (ai.picks || [])) {
    const c = byNorm.get(normTicker(item.ticker));
    if (!c) continue;
    const moonshot = buildMoonshotResult(item, c, hz);
    // Short-term hard rejects: AI-flagged (no catalyst / supply killer / peak
    // crowding / sector downtrend / cooked) OR deterministically illiquid.
    if (hz === "short") {
      const illiquid = c.raw?.liquidityUsdPerDay != null && c.raw.liquidityUsdPerDay < 5_000_000;
      if (moonshot.hardReject || illiquid) { rejectedCount++; continue; }
    }
    try {
      const doc = await StocksDiscoveryCandidate.findOneAndUpdate(
        { email: email.toLowerCase(), ticker: c.ticker, scanDate },
        { $set: {
            email: email.toLowerCase(), ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry,
            exchange: c.exchange, marketCap: c.marketCap, priceAtDiscovery: c.price, currencyAtDiscovery: c.currency,
            score: moonshot.compositeScore ?? 0,
            signals: {
              revenueGrowthPct: c.raw?.fundamentals?.revenueGrowthPct ?? null,
              grossMarginPct: c.raw?.fundamentals?.grossMarginPct ?? null,
              operatingMarginPct: c.raw?.fundamentals?.operatingMarginPct ?? null,
              netDebtToEquity: c.raw?.fundamentals?.netDebtToEquity ?? null,
            },
            thesis: { bullCase: moonshot.finalThesis, killThesis: (moonshot.redFlags || []).join("; "), catalysts: moonshot.keyCatalysts, conviction: moonshot.confidence, sources: moonshot.sources },
            moonshot,
            mosaic: c.mosaic || null,
            scanDate, lastPriceCheckedAt: scanDate, lastPrice: c.price,
          },
          $push: { scoreHistory: { $each: [{ date: scanDate, score: deterministicComposite(c.sub, "balanced"), source: "moonshot" }], $slice: -90 } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      picks.push(doc.toObject());
    } catch (e) { console.warn("[moonshot] save failed:", e?.message); }
  }
  picks.sort((a, b) => (b.moonshot?.compositeScore ?? 0) - (a.moonshot?.compositeScore ?? 0));

  return { picks, market: mkt, horizon: hz, mode: scanMode, upgradeRecommendation, scanDate, disclaimer: MOONSHOT_DISCLAIMER, shortlistSize: shortlist.length, rejectedCount };
}

// Standalone Mosaic Intelligence run for an explicit set of tickers (or the
// caller's holdings). Returns { results: { TICKER: mosaicObject }, mode }.
export async function runMosaicForTickers({ tickers = [], mode = "balanced" }) {
  const candidates = (tickers || [])
    .map((t) => (typeof t === "string" ? { ticker: t.toUpperCase().trim() } : t))
    .filter((c) => c.ticker)
    .slice(0, 8);
  if (!candidates.length) return { results: {}, mode, disclaimer: MOSAIC_DISCLAIMER, error: "No tickers provided." };
  const results = await runMosaicBatch(candidates, mode);
  return { results, mode, disclaimer: MOSAIC_DISCLAIMER };
}

// small local helpers
function clampScore(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; }
function arr(v) { return Array.isArray(v) ? v.filter((x) => x != null).slice(0, 8) : []; }
function str(v) { return typeof v === "string" ? v.slice(0, 1200) : ""; }
function rank(r) { return { Low: 0, Medium: 1, High: 2, Speculative: 3 }[r] ?? 1; }
