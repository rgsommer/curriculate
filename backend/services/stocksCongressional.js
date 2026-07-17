// backend/services/stocksCongressional.js
//
// Congressional trades — Senate/House Periodic Transaction Reports.
// Nancy Pelosi's disclosed trades are famously alpha-generating (documented
// ~10-11% avg annual outperformance vs SPY). The STOCK Act requires
// members of Congress to file PTRs within 45 days. Data is public.
//
// Source: senate-stock-watcher-data mirror on GitHub (updated daily).
// Falls back to null on any fetch failure — never blocks briefing.
//
// We don't fetch by ticker; the full JSON is small enough to fetch
// once (cached 24h) and filter locally against the user's holdings.

const CACHE = { fetchedAt: 0, data: null };
const TTL_MS = 24 * 60 * 60 * 1000;

const SENATE_URL = "https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json";
const HOUSE_URL = "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json";

async function fetchAll(url) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

// Normalize a Senate/House row into a common shape.
function normalizeSenate(row) {
  if (!row) return null;
  const ticker = String(row.ticker || "").toUpperCase().replace(/\..*$/, "");
  if (!ticker || ticker === "--") return null;
  return {
    chamber: "Senate",
    filer: row.senator || row.reporting_person || "Unknown",
    ticker,
    date: row.transaction_date || row.disclosure_date || null,
    type: row.type || "unknown",     // e.g. "Purchase", "Sale (Full)"
    amount: row.amount || null,      // range string, e.g. "$1,001 - $15,000"
  };
}

function normalizeHouse(row) {
  if (!row) return null;
  const ticker = String(row.ticker || "").toUpperCase().replace(/\..*$/, "");
  if (!ticker || ticker === "--") return null;
  return {
    chamber: "House",
    filer: row.representative || row.name || "Unknown",
    ticker,
    date: row.transaction_date || row.disclosure_date || null,
    type: row.type || "unknown",
    amount: row.amount || null,
  };
}

// Deduplicate loosely by (filer, ticker, date, type). Occasionally the
// mirrors double-list a row.
function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const k = `${r.filer}|${r.ticker}|${r.date}|${r.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export async function getRecentCongressionalTrades({ maxAgeDays = 45 } = {}) {
  const now = Date.now();
  if (CACHE.data && now - CACHE.fetchedAt < TTL_MS) return CACHE.data;

  const [senate, house] = await Promise.all([
    fetchAll(SENATE_URL),
    fetchAll(HOUSE_URL),
  ]);
  const normalized = [
    ...senate.map(normalizeSenate),
    ...house.map(normalizeHouse),
  ].filter(Boolean);
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const recent = normalized
    .filter((r) => {
      if (!r.date) return false;
      const d = new Date(r.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const data = dedupe(recent);
  CACHE.data = data;
  CACHE.fetchedAt = now;
  return data;
}

// Filter to trades matching a given ticker set (case-insensitive) within
// the last N days. Used to inject "your holdings have congressional
// activity" hints into the briefing.
export async function getCongressionalTradesForTickers(tickers, { maxAgeDays = 45 } = {}) {
  const all = await getRecentCongressionalTrades({ maxAgeDays });
  if (!Array.isArray(all)) return {};
  const uniq = new Set((tickers || []).map((t) => String(t || "").toUpperCase().replace(/\..*$/, "")));
  const byTicker = {};
  for (const trade of all) {
    if (!uniq.has(trade.ticker)) continue;
    if (!byTicker[trade.ticker]) byTicker[trade.ticker] = [];
    byTicker[trade.ticker].push(trade);
  }
  // Keep top 5 per ticker (most recent first)
  for (const t of Object.keys(byTicker)) {
    byTicker[t] = byTicker[t].slice(0, 5);
  }
  return byTicker;
}

export function formatCongressionalBlock(byTicker) {
  if (!byTicker || Object.keys(byTicker).length === 0) return "";
  const lines = [`\nCONGRESSIONAL TRADES (last 45d disclosures matching your holdings):`];
  for (const [ticker, trades] of Object.entries(byTicker)) {
    const summary = trades
      .slice(0, 3)
      .map((t) => `${t.filer} (${t.chamber}) · ${t.type} · ${t.date} · ${t.amount || "—"}`)
      .join(" · ");
    lines.push(`  ${ticker}: ${summary}`);
  }
  lines.push(`  Members of Congress often have committee-derived information advantages. Multiple recent PURCHASES on a ticker = potential positive catalyst. Multiple SALES = potential negative catalyst. Weight by chamber committee assignments (defense committee member buying defense stock = higher-signal).`);
  return lines.join("\n");
}
