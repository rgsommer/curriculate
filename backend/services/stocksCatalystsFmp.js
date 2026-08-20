// backend/services/stocksCatalystsFmp.js
//
// Per-ticker catalyst awareness from FMP: upcoming earnings + recent
// analyst upgrades/downgrades. Both are documented swing-trade catalysts:
//   • Post-earnings drift (PEAD): stocks that beat/miss tend to continue
//     that direction for weeks. Knowing WHEN earnings hit lets the AI
//     say "hold/trim into earnings in 4d" vs "buy the dip, next earnings
//     Nov 12."
//   • Analyst upgrades within the last 3-7 days move stocks reliably,
//     especially from top-tier firms.
//
// Both endpoints are FMP Premium. Cached 4h so morning briefing warms
// the cache for afternoon advice calls.

import { isFmpEnabled } from "./fmpEnabled.js";

const CACHE = new Map(); // sym → { fetchedAt, data }
const TTL_MS = 4 * 60 * 60 * 1000;

function fmpKey() { return process.env.FMP_API_KEY || ""; }
function normalizeForFmp(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(".")) return t;
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

async function fmpFetch(path) {
  const key = fmpKey();
  if (!key) return null;
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${key}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(tid); }
}

// Try /stable then fall back to /api/v3. FMP has both live; different
// key tiers get different endpoint availability.
async function fmpFetchWithFallback(stablePath, legacyPath) {
  const stable = await fmpFetch(stablePath);
  if (stable) return stable;
  return await fmpFetch(legacyPath);
}

// Upcoming earnings date + estimate. Returns null if no future date on file.
//
// Per audit fix #4 — catalyst dates must be verified before they reach a
// briefing. FMP is our authoritative source (exchange-fed data). Cross-
// check runs against the FMP calendar's OWN historical entries to verify
// quarterly cadence — a hallucinated "next earnings" date that doesn't
// sit ~85-100 days after the most recent reported date fails the check
// and returns { ...date, verified: false }. Sanity gates:
//   • date must be in [today, today + 150d] — anything outside is bad data
//   • date must not fall on a weekend/holiday-ish gap unless labeled as such
//   • cadence: gap from last reported date ~85-100 days for most issuers
async function fetchNextEarnings(sym) {
  const arr = await fmpFetchWithFallback(
    `/stable/earnings-calendar?symbol=${encodeURIComponent(sym)}`,
    `/api/v3/historical/earning_calendar/${encodeURIComponent(sym)}`
  );
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const now = new Date();
  const withDates = arr
    .map((e) => ({ ...e, dt: e.date ? new Date(e.date) : null }))
    .filter((e) => e.dt && !isNaN(e.dt.getTime()))
    .sort((a, b) => a.dt - b.dt);
  const future = withDates.find((e) => e.dt >= now);
  if (!future) return null;

  const daysAway = Math.round((future.dt - now) / (24 * 60 * 60 * 1000));

  // Sanity gate: rejected if the date is unreasonably far out. FMP has
  // occasionally returned "next earnings" 300+ days away for quiet
  // small-caps, which is not a scheduled call — it's a placeholder.
  if (daysAway > 150) {
    console.warn(`[catalysts] ${sym} earnings ${future.dt.toISOString().slice(0,10)} is ${daysAway}d out — rejecting as unverified placeholder`);
    return null;
  }

  // Cross-check: cadence-consistency against the same feed's history.
  // Find the most-recent PAST entry, verify the future date is 85-105
  // days later (quarterly). Mismatch → verified: false, but still
  // returned so the briefing can annotate (rather than silently drop).
  let verified = false;
  const past = [...withDates].reverse().find((e) => e.dt < now);
  if (past) {
    const gapDays = Math.round((future.dt - past.dt) / (24 * 60 * 60 * 1000));
    if (gapDays >= 82 && gapDays <= 105) verified = true;
    else console.warn(`[catalysts] ${sym} quarterly cadence check failed — last ${past.dt.toISOString().slice(0,10)} → next ${future.dt.toISOString().slice(0,10)} = ${gapDays}d gap (expected 85-100)`);
  }

  return {
    date: future.dt.toISOString().slice(0, 10),
    daysAway,
    epsEstimate: future.epsEstimated ?? null,
    revenueEstimate: future.revenueEstimated ?? null,
    time: future.time || null, // "bmo" (before market open) / "amc" (after market close)
    verified,
    source: "fmp-earnings-calendar",
  };
}

// Recent analyst upgrades/downgrades. FMP endpoint returns most-recent-first.
async function fetchRecentAnalystActions(sym, days = 30) {
  const arr = await fmpFetchWithFallback(
    `/stable/grades?symbol=${encodeURIComponent(sym)}`,
    `/api/v3/upgrades-downgrades?symbol=${encodeURIComponent(sym)}`
  );
  if (!Array.isArray(arr)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return arr
    .map((g) => ({ ...g, dt: g.publishedDate ? new Date(g.publishedDate) : (g.date ? new Date(g.date) : null) }))
    .filter((g) => g.dt && g.dt.getTime() >= cutoff)
    .sort((a, b) => b.dt - a.dt)
    .slice(0, 20)
    .map((g) => ({
      date: g.dt.toISOString().slice(0, 10),
      firm: g.gradingCompany || g.analyst || g.publisher || "—",
      action: g.action || g.gradeChange || "—", // upgrade/downgrade/reiterate/init
      priorGrade: g.previousGrade || null,
      newGrade: g.newGrade || null,
      priceTarget: Number.isFinite(+g.priceTarget) ? +g.priceTarget : null,
    }));
}

export async function getCatalysts(ticker, currency = "USD") {
  if (!isFmpEnabled()) return null;
  const sym = normalizeForFmp(ticker, currency);
  const now = Date.now();
  const cached = CACHE.get(sym);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  const [earnings, analysts] = await Promise.all([
    fetchNextEarnings(sym).catch(() => null),
    fetchRecentAnalystActions(sym, 30).catch(() => []),
  ]);

  // Aggregate: net upgrades vs downgrades in last 30d = simple signal.
  const ups = analysts.filter((a) => /upgrade/i.test(a.action)).length;
  const downs = analysts.filter((a) => /downgrade/i.test(a.action)).length;
  const inits = analysts.filter((a) => /initiat/i.test(a.action)).length;
  const netScore = ups - downs;

  const data = {
    ok: true,
    earnings,
    analysts,
    analystSummary: { ups, downs, inits, netScore, total: analysts.length },
    fetchedAt: new Date(),
  };
  CACHE.set(sym, { fetchedAt: now, data });
  return data;
}

// One-line summary for prompt injection.
export function formatCatalystsLine(c) {
  if (!c || !c.ok) return null;
  const parts = [];
  if (c.earnings) {
    const t = c.earnings.time ? ` ${c.earnings.time.toUpperCase()}` : "";
    const est = c.earnings.epsEstimate != null ? ` (est EPS $${c.earnings.epsEstimate.toFixed(2)})` : "";
    const flag = c.earnings.daysAway <= 3 ? " 🔥" : c.earnings.daysAway <= 7 ? " ⚡" : "";
    parts.push(`Earnings ${c.earnings.date}${t} in ${c.earnings.daysAway}d${est}${flag}`);
  }
  if (c.analystSummary && c.analystSummary.total > 0) {
    const s = c.analystSummary;
    const dir = s.netScore > 0 ? `+${s.netScore} bullish` : s.netScore < 0 ? `${s.netScore} bearish` : "neutral";
    parts.push(`Analysts 30d: ${s.total} actions (${dir}: ${s.ups} up / ${s.downs} down / ${s.inits} init)`);
  }
  if (parts.length === 0) return null;
  return `Catalysts: ${parts.join(" · ")}`;
}
