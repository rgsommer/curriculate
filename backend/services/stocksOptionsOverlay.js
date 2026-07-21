// backend/services/stocksOptionsOverlay.js
//
// Concrete options-overlay suggestions on top of the existing IV-rank
// signal. When a held position has IV rank ≥70 (options are "rich"),
// this service picks a target strike + expiry + premium and hands the
// AI a covered-call suggestion it can drop verbatim into the briefing
// — no more "IV rank is 82" without a follow-through.
//
// Rules (deliberately conservative):
//   • Only when IV rank ≥ 70 (top-third of the ticker's own IV history)
//   • Only on positions the user is holding (needs ≥100 shares in a
//     single account for a 1-contract sale)
//   • Only when the position is in an unrealized gain (basis known and
//     current > basis) — a covered call caps upside; capping upside on
//     a losing position piles risk onto risk
//   • Prefer the shortest expiry that is ≥ 25 days out (30-45 DTE
//     range is the sweet spot for premium decay)
//   • Target strike: ~1× monthly implied σ OTM (≈ 25-30 delta approx.
//     without needing a proper Black-Scholes)
//
// Cash-secured puts on WATCHED (not held) tickers is a natural sibling
// but out of scope for this pass — the "held" gate keeps this MVP tight.

import { getOptionsMetrics } from "./stocksOptionsMetrics.js";

const YAHOO_OPT = "https://query2.finance.yahoo.com/v7/finance/options";

async function fetchChainForExpiry(ticker, expirationEpoch) {
  const url = `${YAHOO_OPT}/${encodeURIComponent(ticker)}${expirationEpoch ? `?date=${expirationEpoch}` : ""}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Curriculate Overlay)" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.optionChain?.result?.[0];
    if (!result) return null;
    return {
      quote: result.quote || null,
      expirations: result.expirationDates || [],
      calls: result.options?.[0]?.calls || [],
      puts: result.options?.[0]?.puts || [],
      expiration: result.options?.[0]?.expirationDate || expirationEpoch || null,
    };
  } catch { return null; } finally { clearTimeout(tid); }
}

// From a list of expiration epochs, pick the shortest that's ≥ 25 days
// away. Falls back to the first expiration if all are shorter.
function pickTargetExpiry(expirations) {
  if (!Array.isArray(expirations) || expirations.length === 0) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const twentyFiveDaysSec = 25 * 24 * 60 * 60;
  const eligible = expirations.filter((e) => e - nowSec >= twentyFiveDaysSec);
  return eligible.length > 0 ? eligible[0] : expirations[0];
}

// Approximate "1× monthly implied σ" from currentIV (annualized %) and
// days-to-expiration. Uses σ_dte = σ_annual × √(dte/365).
function targetStrikeOtm(spot, ivPct, dteDays) {
  if (!Number.isFinite(spot) || !Number.isFinite(ivPct) || !Number.isFinite(dteDays)) return null;
  const sigmaAnnual = ivPct / 100;
  const sigmaDte = sigmaAnnual * Math.sqrt(Math.max(1, dteDays) / 365);
  return spot * (1 + sigmaDte);
}

// From a call chain, pick the strike closest to the target. Prefers
// calls with at least SOME bid volume so the mid price is real.
function pickCallNearStrike(calls, targetStrike) {
  const eligible = (calls || []).filter((c) =>
    Number.isFinite(c.strike) &&
    Number.isFinite(c.bid) &&
    c.bid > 0
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike));
  return eligible[0];
}

// Very rough delta approximation for OTM calls: use standard-normal
// CDF at d1 = (ln(S/K) + (σ²/2)·T) / (σ·√T), with r=0. Not accurate
// enough to hedge with, but fine for a "roughly 25-30 delta" tag on
// the briefing suggestion.
function approxCallDelta(spot, strike, ivPct, dteDays) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(ivPct) || !(dteDays > 0)) return null;
  const sigma = ivPct / 100;
  const T = dteDays / 365;
  const denom = sigma * Math.sqrt(T);
  if (denom <= 0) return null;
  const d1 = (Math.log(spot / strike) + (sigma * sigma / 2) * T) / denom;
  // Standard-normal CDF via error function approximation
  const erf = (x) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  return 0.5 * (1 + erf(d1 / Math.sqrt(2)));
}

// Compute avg cost basis per share for the ticker across all lots so we
// can gate the overlay behind "in an unrealized gain."
function avgBasis(positions, ticker) {
  const lots = positions.filter((p) => String(p.ticker || "").toUpperCase() === ticker && (p.qty || 0) > 0);
  if (lots.length === 0) return null;
  let cost = 0, qty = 0;
  for (const l of lots) {
    if (!Number.isFinite(l.avgCost) || !(l.qty > 0)) continue;
    cost += l.avgCost * l.qty;
    qty += l.qty;
  }
  return qty > 0 ? cost / qty : null;
}

// Total shares held for a ticker across all lots/accounts.
function totalShares(positions, ticker) {
  return positions
    .filter((p) => String(p.ticker || "").toUpperCase() === ticker)
    .reduce((s, p) => s + (p.qty || 0), 0);
}

// Build overlay suggestions for every held ticker that meets the gate.
// Returns [] on any failure so the caller never has to null-check.
export async function computeOverlaySuggestions({ positions, fxUsdCad = 1.37 }) {
  if (!positions || positions.length === 0) return [];
  const heldTickers = [...new Set(positions.map((p) => String(p.ticker || "").toUpperCase()))].filter(Boolean);

  const out = [];
  await Promise.all(heldTickers.map(async (ticker) => {
    try {
      // Gate 1: enough shares for 1 contract (100 sh).
      const shares = totalShares(positions, ticker);
      if (shares < 100) return;
      // Gate 2: IV rank ≥ 70 (options are relatively rich).
      const opt = await getOptionsMetrics(ticker).catch(() => null);
      if (!opt || !(opt.ivRankPct >= 70) || !Number.isFinite(opt.currentIVPct) || !Number.isFinite(opt.spot)) return;
      // Gate 3: position is in an unrealized gain (avg basis exists and
      // spot > basis). If basis unknown, allow with a note.
      const basis = avgBasis(positions, ticker);
      const inGain = basis == null ? null : opt.spot > basis;
      if (basis != null && !inGain) return;

      // Fetch chain to get available expirations, then pick the target
      // expiry ≥25 days out.
      const initial = await fetchChainForExpiry(ticker, null);
      if (!initial) return;
      const targetExp = pickTargetExpiry(initial.expirations);
      if (!targetExp) return;

      const chain = targetExp === initial.expiration ? initial : await fetchChainForExpiry(ticker, targetExp);
      if (!chain) return;
      const dteDays = Math.round((targetExp - Date.now() / 1000) / 86400);

      const targetStrike = targetStrikeOtm(opt.spot, opt.currentIVPct, dteDays);
      if (!targetStrike) return;
      const call = pickCallNearStrike(chain.calls, targetStrike);
      if (!call) return;

      const bid = Number.isFinite(call.bid) ? call.bid : 0;
      const ask = Number.isFinite(call.ask) ? call.ask : 0;
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (bid || ask);
      const contracts = Math.floor(shares / 100);
      const premiumPerContract = mid * 100;
      const totalPremium = premiumPerContract * contracts;
      const delta = approxCallDelta(opt.spot, call.strike, opt.currentIVPct, dteDays);
      // Monthly yield: premium as % of the position's spot value, annualized
      // by 30/DTE for comparability across expirations.
      const monthlyYieldPct = ((mid / opt.spot) * (30 / Math.max(1, dteDays))) * 100;
      const upsidePct = ((call.strike - opt.spot) / opt.spot) * 100;

      out.push({
        ticker,
        spot: opt.spot,
        ivRankPct: opt.ivRankPct,
        ivPct: opt.currentIVPct,
        expiration: new Date(targetExp * 1000).toISOString().slice(0, 10),
        dteDays,
        strike: call.strike,
        bid, ask, mid,
        deltaApprox: delta,
        contracts,
        sharesCovered: contracts * 100,
        premiumPerContract,
        totalPremium,
        monthlyYieldPct,
        upsidePct,
        basis,
      });
    } catch { /* per-ticker failure is silent — best-effort suggestions */ }
  }));

  // Rank by monthly yield desc so the briefing surfaces the fattest
  // premium first when there are multiple candidates.
  out.sort((a, b) => (b.monthlyYieldPct || 0) - (a.monthlyYieldPct || 0));
  return out;
}

// Format a compact OPTIONS OVERLAY block for the briefing prompt.
export function formatOverlayBlock(suggestions) {
  if (!suggestions || suggestions.length === 0) return "";
  const lines = [`\nOPTIONS OVERLAY (IV rank ≥ 70 on held names — options are rich; premium worth selling):`];
  for (const s of suggestions.slice(0, 5)) {
    const yieldPct = Number.isFinite(s.monthlyYieldPct) ? `${s.monthlyYieldPct.toFixed(2)}%/mo` : "—";
    const delta = Number.isFinite(s.deltaApprox) ? `~${(s.deltaApprox * 100).toFixed(0)}Δ` : "—";
    const upside = Number.isFinite(s.upsidePct) ? `${s.upsidePct >= 0 ? "+" : ""}${s.upsidePct.toFixed(1)}% OTM` : "";
    lines.push(
      `  ${s.ticker}: SELL ${s.contracts} × ${s.expiration} $${s.strike.toFixed(2)} CALL @ $${s.mid.toFixed(2)} mid · IV rank ${s.ivRankPct.toFixed(0)} · ${delta} · ${upside} · ${yieldPct} · collects ~$${Math.round(s.totalPremium).toLocaleString()} on ${s.sharesCovered} sh${s.basis ? ` (basis $${s.basis.toFixed(2)}, current $${s.spot.toFixed(2)})` : ""}`
    );
  }
  lines.push(`\nHow to use:`);
  lines.push(`  - Emit a section-6a "Options overlay" card citing the top 1-2 suggestions verbatim (strike, expiration, mid premium, monthly yield).`);
  lines.push(`  - Rec format: "SELL to open <N> <TICKER> <exp> $<K> CALL @ limit $<mid>" plus a one-line note about the setup ("collects $X premium; caps upside at $K, ~+Y% from spot; if assigned you're happy exiting there since the trade is already up Z%").`);
  lines.push(`  - Skip the overlay if the underlying has an earnings date inside the expiration window — IV crush post-earnings is the ONE case where the "sell rich premium" rule flips.`);
  return lines.join("\n");
}
