// backend/services/stocksOptionsFlow.js
//
// Unified options-flow service. Dispatches based on kill-switch:
//
//   • UNUSUAL_WHALES_API_KEY present AND OPTIONS_FLOW_DISABLED != "1"
//       → hit UW REST API for rich flow data (sweeps, IV skew, notional)
//   • else
//       → fall back to the free Yahoo option-chain heuristic
//         (services/stocksUnusualOptionsFlow.js — already integrated,
//         proven, and cached 30 min per ticker)
//
// Both paths yield a normalized signal shape that persists into
// StocksOptionsSignal + renders through formatOptionsFlowBlock().
//
// This service does NOT duplicate the Yahoo heuristic that already
// exists — it wraps it so callers can pick a single import
// (getOptionsFlowForUser / formatOptionsFlowBlock) that Just Works
// whether or not a UW subscription is configured.

import { isOptionsFlowEnabled, optionsFlowDisabledReason } from "./optionsFlowEnabled.js";
import { scanUnusualOptionsFlow, getUnusualOptionsFlow } from "./stocksUnusualOptionsFlow.js";
import StocksOptionsSignal from "../models/StocksOptionsSignal.js";

const UW_BASE = "https://api.unusualwhales.com/api";
const FETCH_TIMEOUT_MS = 8000;
// Notional threshold (USD) for a "sweep" — spec Part 4: single orders > $100K
const SWEEP_MIN_NOTIONAL = 100_000;

async function uwFetch(path) {
  const key = (process.env.UNUSUAL_WHALES_API_KEY || "").trim();
  if (!key) return { ok: false, reason: "no_uw_key" };
  const url = path.startsWith("http") ? path : `${UW_BASE}${path}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (r.status === 429) return { ok: false, reason: "http_429" };
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const j = await r.json().catch(() => null);
    return { ok: true, body: j };
  } catch (e) {
    return { ok: false, reason: e?.message || "fetch_failed" };
  } finally {
    clearTimeout(tid);
  }
}

// Best-effort UW fetch for one ticker. UW's public endpoints have
// shifted over time, so we accept several plausible shapes and treat
// any inability to parse as "not available" — the Yahoo fallback still
// works. Returns a normalized array of signals ready to persist.
async function fetchUwSignalsForTicker(ticker) {
  const tk = String(ticker || "").toUpperCase();
  if (!tk) return [];
  // The `/stock/{ticker}/flow-alerts` endpoint returns high-value sweep
  // / block trades tagged bullish/bearish. Fields observed: ticker,
  // total_premium, total_size, type (Call|Put), side_pref (A|B), timestamp.
  const res = await uwFetch(`/stock/${encodeURIComponent(tk)}/flow-alerts?limit=100`);
  if (!res.ok) return [];
  const rows = Array.isArray(res.body?.data) ? res.body.data
             : Array.isArray(res.body) ? res.body : [];
  const out = [];
  for (const r of rows) {
    const notional = Number.parseFloat(r?.total_premium ?? r?.premium ?? r?.notional) || 0;
    if (notional < SWEEP_MIN_NOTIONAL) continue;
    const isCall = /call/i.test(String(r?.type || r?.option_type || ""));
    const isPut = /put/i.test(String(r?.type || r?.option_type || ""));
    const sidePref = String(r?.side_pref || r?.side || "").toUpperCase();
    // Ask-side (A) = aggressive buyer; bid-side (B) = aggressive seller.
    const askSide = sidePref === "A" || sidePref === "ASK";
    const bidSide = sidePref === "B" || sidePref === "BID";
    let signalType = null;
    if (isCall && askSide) signalType = "sweep_bullish";
    else if (isPut && askSide) signalType = "sweep_bearish";
    else if (isCall && bidSide) signalType = "sweep_bearish";
    else if (isPut && bidSide) signalType = "sweep_bullish";
    if (!signalType) continue;
    // Strength: scale by notional, capped at 10 for $2M+
    const strength = Math.min(10, Math.max(1, Math.round(notional / 200_000)));
    out.push({
      ticker: tk,
      signalType,
      strength,
      source: "uw",
      detectedAt: r?.timestamp ? new Date(r.timestamp) : new Date(),
      meta: {
        notionalUsd: notional,
        contracts: Number.parseInt(r?.total_size ?? r?.size ?? 0, 10) || null,
        expiration: r?.expiry || r?.expiration || null,
        strike: r?.strike || null,
        optionType: isCall ? "call" : "put",
        sidePref,
      },
    });
  }
  return out;
}

// Convert a Yahoo-fallback signal object (from scanUnusualOptionsFlow)
// into 0..N normalized StocksOptionsSignal-shaped rows.
function yahooToNormalizedSignals(y) {
  if (!y || !y.ticker) return [];
  const rows = [];
  const now = new Date();
  // Aggregate: put_call_extreme when dollar ratio ≥ 4 or ≤ 0.25
  const r = y.callPutDollarRatio;
  if (Number.isFinite(r) && (r >= 4 || (r > 0 && r <= 0.25))) {
    rows.push({
      ticker: y.ticker,
      signalType: "put_call_extreme",
      strength: Math.min(10, Math.max(5, r >= 4 ? Math.round(r) : Math.round(1 / r))),
      source: "yahoo",
      detectedAt: now,
      meta: {
        callPutDollarRatio: r,
        bias: y.bias,
        totalCallDollar: y.totalCallDollar,
        totalPutDollar: y.totalPutDollar,
        expiration: y.expiration,
        spot: y.spot,
      },
    });
  }
  // Per-strike unusual volume: single row per ticker summarizing the
  // loudest 3 strikes so the AI has concrete strikes to cite.
  if (Array.isArray(y.unusualStrikes) && y.unusualStrikes.length > 0) {
    const top = y.unusualStrikes.slice(0, 3);
    const totalNotional = top.reduce((s, u) => s + (u.dollarVol || 0), 0);
    rows.push({
      ticker: y.ticker,
      signalType: "unusual_call_volume",
      strength: Math.min(10, Math.max(3, Math.round(totalNotional / 100_000))),
      source: "yahoo",
      detectedAt: now,
      meta: {
        bias: y.bias,
        expiration: y.expiration,
        spot: y.spot,
        strikes: top.map(u => ({
          side: u.side, strike: u.strike, volume: u.volume,
          openInterest: u.openInterest, volOiRatio: u.volOiRatio,
          dollarVol: u.dollarVol, offset: u.offset,
        })),
      },
    });
  }
  return rows;
}

// Dedupe by (ticker, signalType, UTC day) — write only if we don't
// already have a signal of the same type today.
async function persistIfNew(sig) {
  const dayStart = new Date(sig.detectedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const existing = await StocksOptionsSignal.findOne({
    ticker: sig.ticker,
    signalType: sig.signalType,
    detectedAt: { $gte: dayStart, $lt: dayEnd },
  }).lean();
  if (existing) return existing;
  try {
    const doc = await StocksOptionsSignal.create(sig);
    return doc.toObject();
  } catch (e) {
    console.warn(`[options-flow] persist ${sig.ticker} ${sig.signalType} warn: ${e?.message}`);
    return null;
  }
}

// Top-level: given a list of tickers, produce normalized signals and
// persist them. Falls back automatically if UW is unavailable/disabled.
export async function scanOptionsFlow(tickers, { concurrency = 5 } = {}) {
  const uniq = [...new Set((tickers || []).map(t => String(t || "").toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return { source: "none", signals: [] };

  const uwOn = isOptionsFlowEnabled();
  const collected = [];

  if (uwOn) {
    // Bounded fan-out
    for (let i = 0; i < uniq.length; i += concurrency) {
      const slice = uniq.slice(i, i + concurrency);
      const results = await Promise.all(slice.map(t => fetchUwSignalsForTicker(t).catch(() => [])));
      for (const arr of results) for (const sig of arr) collected.push(sig);
    }
  }

  // ALWAYS also run the Yahoo scanner — even with UW on, Yahoo picks up
  // the deep put/call ratio and unusual-strike heuristics UW's flow-alerts
  // endpoint doesn't surface. When UW is off Yahoo IS the whole signal.
  const yahooScan = await scanUnusualOptionsFlow(uniq, { concurrency }).catch(() => []);
  for (const y of yahooScan || []) {
    for (const sig of yahooToNormalizedSignals(y)) collected.push(sig);
  }

  // Persist (best-effort — don't fail the whole scan on a single write error).
  const persisted = [];
  for (const sig of collected) {
    const row = await persistIfNew(sig);
    if (row) persisted.push(row);
  }

  return {
    source: uwOn ? "uw+yahoo" : "yahoo",
    disabledReason: uwOn ? null : optionsFlowDisabledReason(),
    signals: persisted,
  };
}

// Read recent persisted signals for a set of tickers — used by the
// briefing to inject a compact block without re-scanning.
export async function getRecentOptionsSignals(tickers, { days = 5, limit = 30 } = {}) {
  const uniq = [...new Set((tickers || []).map(t => String(t || "").toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return [];
  const since = new Date(Date.now() - days * 86400 * 1000);
  return await StocksOptionsSignal.find({
    ticker: { $in: uniq },
    detectedAt: { $gte: since },
  }).sort({ detectedAt: -1, strength: -1 }).limit(limit).lean();
}

// Convenience: fetch (and persist) signals across the user's held +
// starred tickers. Used by the daily-briefing pipeline.
export async function getOptionsFlowForUser(profile, { maxTickers = 20 } = {}) {
  const held = (profile?.positions || []).map(p =>
    String(p.ticker || "").toUpperCase().replace(/\..*$/, "")
  ).filter(Boolean);
  let starred = [];
  try {
    const StocksDiscoveryCandidate = (await import("../models/StocksDiscoveryCandidate.js")).default;
    const rows = await StocksDiscoveryCandidate.find({
      email: profile?.email?.toLowerCase(),
      starred: true, dismissed: { $ne: true },
    }).select({ ticker: 1 }).lean();
    starred = rows.map(r => String(r.ticker || "").toUpperCase());
  } catch { /* starred lookup optional */ }
  const universe = [...new Set([...held, ...starred])].slice(0, maxTickers);
  if (universe.length === 0) return { source: "none", signals: [] };
  return await scanOptionsFlow(universe);
}

// ─── Prompt-injection formatter ───────────────────────────────────────
// Returns "" when there's nothing to render (no nag string). Compact
// bulleted list — one line per signal, source tag when Yahoo (delayed/
// thin data, per spec's anti-patterns).
export function formatOptionsFlowBlock(payload) {
  const signals = Array.isArray(payload) ? payload
                : Array.isArray(payload?.signals) ? payload.signals
                : null;
  if (!signals || signals.length === 0) return "";

  // Group by ticker for compactness.
  const byTicker = new Map();
  for (const s of signals) {
    const key = s.ticker;
    if (!byTicker.has(key)) byTicker.set(key, []);
    byTicker.get(key).push(s);
  }

  const lines = [`\nOPTIONS FLOW (past 5 trading days — held names + watchlist):`];
  for (const [ticker, sigs] of byTicker.entries()) {
    // Prioritize sweep > put_call_extreme > unusual_call_volume for display
    sigs.sort((a, b) => (b.strength || 0) - (a.strength || 0));
    const parts = [];
    for (const s of sigs.slice(0, 3)) {
      const src = s.source === "yahoo" ? " [Yahoo]" : "";
      if (s.signalType === "sweep_bullish") {
        parts.push(`🟢 bullish sweep${src} ($${Math.round((s.meta?.notionalUsd || 0) / 1000)}k notional)`);
      } else if (s.signalType === "sweep_bearish") {
        parts.push(`🔴 bearish sweep${src} ($${Math.round((s.meta?.notionalUsd || 0) / 1000)}k notional)`);
      } else if (s.signalType === "put_call_extreme") {
        const r = s.meta?.callPutDollarRatio;
        const rTxt = Number.isFinite(r) ? (r >= 1 ? `${r.toFixed(1)}× call$` : `${(1/r).toFixed(1)}× put$`) : "";
        parts.push(`${s.meta?.bias === "bearish" ? "🔴" : "🟢"} P/C extreme${src} (${rTxt})`);
      } else if (s.signalType === "unusual_call_volume") {
        const top = (s.meta?.strikes || [])[0];
        const strikeTxt = top ? ` (top: ${top.side?.toUpperCase()} $${top.strike})` : "";
        parts.push(`⚡ unusual volume${src}${strikeTxt}`);
      } else if (s.signalType === "iv_compression") {
        parts.push(`💤 IV crush candidate${src}`);
      }
    }
    if (parts.length) lines.push(`  ${ticker}: ${parts.join(" · ")}`);
  }
  lines.push(`  Caveat: options flow is a CORROBORATING signal — do NOT act on it in isolation. Combine with fundamentals + technicals + sector rotation. Yahoo-tagged rows are delayed / heuristic-only; UW rows carry order-level detail.`);
  return lines.join("\n");
}
