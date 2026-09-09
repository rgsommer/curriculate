// backend/jobs/stocksDailyPositionSnapshot.js
//
// P3.5 (2026-09-09) — daily per-ticker snapshot writer.
//
// Reads the user's StocksPortfolio positions (current live view) and
// writes one StocksDailyPositionSnapshot row per (email, date,
// account, ticker) so future P3.5/P4 attribution can look up
// what-we-knew-then rather than reconstructing from journals.
//
// Idempotent per (email, date, account, ticker) — a same-day rerun
// overwrites rather than duplicates. Fire-and-forget from a cron; a
// persistence failure is logged and the run continues.

import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksDailyPositionSnapshot from "../models/StocksDailyPositionSnapshot.js";
import { fetchYahooDaily } from "../services/stocksDiscoveryScore.js";
import { classifyPosition } from "../services/stocksSleeveEnforcer.js";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";

function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }

async function priceForTicker(ticker) {
  try {
    const bars = await fetchYahooDaily(ticker, "5d");
    return Array.isArray(bars) && bars.length > 0 ? Number(bars[bars.length - 1].close) : null;
  } catch { return null; }
}

// PUBLIC — write today's snapshot rows for a single user.
export async function writeDailyPositionSnapshotForUser(email) {
  const em = String(email || "").toLowerCase();
  const portfolio = await StocksPortfolio.findOne({ email: em }).lean().catch(() => null);
  if (!portfolio) return { ok: false, reason: "no-portfolio" };
  const date = ymd();
  const positions = portfolio.positions || [];
  const fxUsdCad = Number(portfolio.fxUsdCad || 1.37);
  const ops = [];
  let priced = 0, unpriced = 0;
  for (const p of positions) {
    if (!p.ticker || !(p.qty > 0)) continue;
    const currency = p.ccy || "USD";
    const priceNative = Number.isFinite(p.priceUsd) && currency === "USD" ? p.priceUsd
                      : Number.isFinite(p.priceCad) && currency === "CAD" ? p.priceCad
                      : await priceForTicker(p.ticker);
    if (Number.isFinite(priceNative)) priced++; else unpriced++;
    const marketValueCad = Number.isFinite(priceNative)
      ? p.qty * priceNative * (currency === "CAD" ? 1 : fxUsdCad) : null;
    const sleeve = classifyPosition({ ticker: p.ticker });
    ops.push({
      updateOne: {
        filter: { email: em, date, account: p.account || null, ticker: p.ticker },
        update: { $set: {
          email: em, date, account: p.account || null, ticker: p.ticker,
          shares: p.qty, priceNative, currency, fxUsdCad,
          marketValueCad, costBasisNative: p.avgCost || null,
          sleeve, sector: p.sector || null, industry: p.industry || null,
          linkedRecommendationId: p.linkedRecommendationId || null,
        }},
        upsert: true,
      },
    });
  }
  try {
    if (ops.length > 0) await StocksDailyPositionSnapshot.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.warn(`[daily-position-snapshot] persist warn for ${em}:`, e?.message);
  }
  return { ok: true, rows: ops.length, priced, unpriced, date };
}

// PUBLIC — write for every enabled user.
export async function runDailyPositionSnapshotJob() {
  const portfolios = await StocksPortfolio.find({}).lean().catch(() => []);
  let ok = 0, fail = 0, rows = 0;
  for (const p of portfolios) {
    try {
      const r = await writeDailyPositionSnapshotForUser(p.email);
      if (r.ok) { ok++; rows += r.rows || 0; } else fail++;
    } catch { fail++; }
  }
  const summary = { ok, fail, rows };
  console.log(`[daily-position-snapshot] wrote ${ok} portfolios, ${rows} rows, ${fail} failed`);
  try {
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: "stocks-daily-position-snapshot" },
      { $set: { lastTickAt: new Date(), lastRunSummary: summary, lastError: null, lastErrorAt: null } },
      { upsert: true, setDefaultsOnInsert: true },
    ).catch(() => {});
  } catch { /* soft */ }
  return summary;
}
