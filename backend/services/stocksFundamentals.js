// backend/services/stocksFundamentals.js
//
// Fetches structured fundamental data from Financial Modeling Prep (FMP).
// Used to give the AI advice pipeline real numbers (P/E, P/S, dividend
// yield, debt ratios, sector) instead of guessing from scraped web pages.
//
// Free tier: 250 calls/day. Each ticker = 3 calls (profile + ratios + key
// metrics) → ~80 unique tickers/day supported. Aggressively cached for 6h.
//
// Env: FMP_API_KEY required. If absent, all calls return { ok: false }
// and the pipeline silently falls back to its prior behaviour.

const CACHE = new Map(); // ticker → { fetchedAt, data }
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function fmpKey() {
  return process.env.FMP_API_KEY || "";
}

async function fmpGet(path) {
  const key = fmpKey();
  if (!key) throw new Error("FMP_API_KEY not configured");
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`FMP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(tid);
  }
}

// FMP uses different ticker conventions for Canadian listings: .TO suffix.
// Best-effort: if a ticker looks Canadian and isn't already suffixed, add ".TO".
function normalizeForFmp(ticker, currency) {
  const t = ticker.toUpperCase().trim();
  // Already qualified
  if (t.includes(".")) return t;
  // Common Canadian dividend payers — try .TO
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

export async function getFundamentals(ticker, currency = "USD") {
  const lookup = normalizeForFmp(ticker, currency);
  const now = Date.now();
  const cached = CACHE.get(lookup);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  let data;
  try {
    if (!fmpKey()) {
      data = { ok: false, reason: "FMP_API_KEY not set" };
    } else {
      // Three endpoints in parallel
      const [profile, ratios, metrics] = await Promise.all([
        fmpGet(`/api/v3/profile/${encodeURIComponent(lookup)}`).catch(() => null),
        fmpGet(`/api/v3/ratios-ttm/${encodeURIComponent(lookup)}`).catch(() => null),
        fmpGet(`/api/v3/key-metrics-ttm/${encodeURIComponent(lookup)}`).catch(() => null),
      ]);
      const p = Array.isArray(profile) ? profile[0] : profile;
      const r = Array.isArray(ratios) ? ratios[0] : ratios;
      const m = Array.isArray(metrics) ? metrics[0] : metrics;
      if (!p && !r && !m) {
        data = { ok: false, reason: "no data for symbol" };
      } else {
        data = {
          ok: true,
          symbol: lookup,
          companyName: p?.companyName || null,
          sector: p?.sector || null,
          industry: p?.industry || null,
          marketCap: p?.mktCap || null,
          beta: p?.beta || null,
          currency: p?.currency || currency,
          peRatio: r?.peRatioTTM ?? r?.priceEarningsRatioTTM ?? null,
          psRatio: r?.priceToSalesRatioTTM ?? null,
          pbRatio: r?.priceToBookRatioTTM ?? null,
          dividendYieldPct: r?.dividendYielTTM != null ? r.dividendYielTTM * 100 : (r?.dividendYieldTTM != null ? r.dividendYieldTTM * 100 : null),
          payoutRatio: r?.payoutRatioTTM ?? null,
          debtToEquity: r?.debtEquityRatioTTM ?? null,
          currentRatio: r?.currentRatioTTM ?? null,
          roeTTM: r?.returnOnEquityTTM != null ? r.returnOnEquityTTM * 100 : null,
          revenuePerShare: m?.revenuePerShareTTM ?? null,
          fcfPerShare: m?.freeCashFlowPerShareTTM ?? null,
          fcfYieldPct: m?.freeCashFlowYieldTTM != null ? m.freeCashFlowYieldTTM * 100 : null,
        };
      }
    }
  } catch (e) {
    data = { ok: false, reason: e?.message || "fetch failed" };
  }

  CACHE.set(lookup, { fetchedAt: now, data });
  return data;
}

// One-liner human-readable formatter for injection into prompts.
export function formatFundamentalsLine(f) {
  if (!f || !f.ok) return `Fundamentals: unavailable${f?.reason ? ` (${f.reason})` : ""}`;
  const parts = [];
  if (f.marketCap != null) {
    const cap = f.marketCap >= 1e12 ? `${(f.marketCap / 1e12).toFixed(2)}T`
              : f.marketCap >= 1e9 ? `${(f.marketCap / 1e9).toFixed(1)}B`
              : f.marketCap >= 1e6 ? `${(f.marketCap / 1e6).toFixed(0)}M`
              : `${f.marketCap.toFixed(0)}`;
    parts.push(`mcap $${cap}`);
  }
  if (f.peRatio != null) {
    const peLabel = f.peRatio < 0 ? "negative" : f.peRatio < 15 ? "cheap" : f.peRatio > 40 ? "expensive" : "normal";
    parts.push(`P/E ${f.peRatio.toFixed(1)} (${peLabel})`);
  }
  if (f.psRatio != null) parts.push(`P/S ${f.psRatio.toFixed(1)}`);
  if (f.dividendYieldPct != null && f.dividendYieldPct > 0.01) parts.push(`div ${f.dividendYieldPct.toFixed(2)}%`);
  if (f.debtToEquity != null && f.debtToEquity > 0) parts.push(`D/E ${f.debtToEquity.toFixed(2)}`);
  if (f.fcfYieldPct != null) parts.push(`FCF yield ${f.fcfYieldPct.toFixed(1)}%`);
  if (f.beta != null) parts.push(`β ${f.beta.toFixed(2)}`);
  if (f.sector) parts.push(f.sector);
  return parts.join(" · ");
}
