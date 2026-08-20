// backend/services/portfolioCalcEngine.js
//
// Phase 3 of the Stocks Advisor rewrite (spec §24):
// THE canonical portfolio calculation engine — every percentage the
// system reports must trace to this file.
//
// Per user's spec:
//   "Every percentage displayed in the briefing must originate from
//    the same canonical portfolio calculation engine. The LLM must
//    NEVER independently calculate, infer, approximate, or rewrite
//    portfolio percentages."
//
// This module returns a "canonical portfolio object" — a deterministic,
// exhaustive snapshot with every %, $ CAD equivalent, and variance
// explicitly field-typed. Downstream code (briefing render, validators,
// dashboard, alpha calc) consumes this object; nothing else computes
// weights independently.
//
// Field-typing convention (per user's spec):
//   position_weight_pct        — position CAD value / total portfolio value
//   sleeve_weight_pct          — Σ(positions in sleeve) / total portfolio value
//   sleeve_target_pct          — configured target
//   sleeve_variance_pp         — actual - target (percentage points, not %)
//   sleeve_remaining_capacity_pct — max(0, max_allowed - actual)
//   sector_weight_pct          — Σ(sector positions) / total portfolio value
//   account_weight_pct         — account book value / total portfolio value
//   cash_pct                   — cash CAD equivalent / total portfolio value
//   position_return_pct        — signed since cost basis
//
// Reconciliation contract (per spec):
//   Position weights sum to (100 - cash_pct) ± ROUNDING_TOLERANCE_PP.
//   Sleeve weights sum to (100 - cash_pct) ± ROUNDING_TOLERANCE_PP.
//   Account weights sum to 100 ± ROUNDING_TOLERANCE_PP.
//   Any drift beyond tolerance → warnings[] with the exact delta so
//   the caller can surface "rounding difference: 0.3pp" not silently
//   patch individual numbers.
//
// This engine is PURE — no I/O, no async. Given the same profile
// input it always returns the same canonical object. Callers that
// need live prices patch them into the profile.positions before calling.

import { classifyPosition, computeSleeveBalance } from "./stocksSleeveEnforcer.js";
import { mapTickerToSector } from "./stocksSectorRotation.js";

// ─── Reconciliation constants ────────────────────────────────────────
export const ROUNDING_TOLERANCE_PP = 0.5;
export const CONCENTRATION_WARN_PCT = 15;
export const CONCENTRATION_BREACH_PCT = 20;
export const SINGLE_ACCOUNT_WARN_PCT = 60;

// ─── Helpers ─────────────────────────────────────────────────────────
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Position CAD value — prefer priceCad if present (matches Dashboard),
// otherwise convert priceUsd × fx.
function positionValueCad(p, fx) {
  if (!p) return 0;
  const priceCad = Number.isFinite(p.priceCad) ? p.priceCad : null;
  const priceUsd = Number.isFinite(p.priceUsd) ? p.priceUsd : null;
  const qty = p.qty || 0;
  if (priceCad != null) return priceCad * qty;
  if (priceUsd != null) return priceUsd * qty * fx;
  return 0;
}

// Signed return from cost basis. Distinguished from stop-distance and
// daily-change per spec §24 "Stop Percentage Integrity".
function positionReturnPct(p) {
  if (!p) return null;
  const basis = p.avgCost ?? p.costBasis;
  const price = Number.isFinite(p.priceCad) ? p.priceCad : p.priceUsd;
  if (!Number.isFinite(basis) || !Number.isFinite(price) || basis <= 0) return null;
  return ((price - basis) / basis) * 100;
}

// Stop-distance metrics — distinct from position return. Per spec §24:
// "A stock being down 3.15% today does NOT mean a 3.15% stop has been
//  breached."
function stopDistanceMetrics(p) {
  const price = Number.isFinite(p.priceCad) ? p.priceCad : p.priceUsd;
  const stop = Number.isFinite(p.hardStopPrice) ? p.hardStopPrice
    : Number.isFinite(p.stopPrice) ? p.stopPrice : null;
  const trailStop = Number.isFinite(p.trailStopPrice) ? p.trailStopPrice : null;
  const trailHwm = Number.isFinite(p.trailHwm) ? p.trailHwm : null;

  return {
    current_price: Number.isFinite(price) ? price : null,
    hard_stop_price: stop,
    distance_to_hard_stop_pct: (Number.isFinite(price) && Number.isFinite(stop) && stop > 0 && price > 0)
      ? ((price - stop) / price) * 100 : null,
    trailing_stop_price: trailStop,
    distance_to_trailing_stop_pct: (Number.isFinite(price) && Number.isFinite(trailStop) && trailStop > 0 && price > 0)
      ? ((price - trailStop) / price) * 100 : null,
    trailing_hwm: trailHwm,
    // Impossible-stop flag: hard stop above current is either bad data
    // OR a short-side rec masquerading as long. Downstream (audit) uses
    // this to fire a HIGH severity blocker per spec §24.
    hard_stop_above_current: Number.isFinite(stop) && Number.isFinite(price) && stop > price,
    // Same for trailing stop
    trailing_stop_above_current: Number.isFinite(trailStop) && Number.isFinite(price) && trailStop > price,
    // Trail HWM inconsistency: stop can't legitimately exceed HWM
    trail_stop_above_hwm: Number.isFinite(trailStop) && Number.isFinite(trailHwm) && trailStop > trailHwm,
  };
}

// Sum with a numeric guard — silently drops NaN/undefined but records
// how many entries were skipped so callers can decide whether it's
// suspicious.
function safeSum(values) {
  let sum = 0;
  let skipped = 0;
  for (const v of values || []) {
    if (Number.isFinite(v)) sum += v; else skipped++;
  }
  return { sum, skipped };
}

// ─── Main entry ──────────────────────────────────────────────────────
// Returns a "canonical portfolio object":
//   {
//     asOf: ISO string,
//     fxUsdCad: number,
//     totals: { book_cad, cash_cad_equiv, portfolio_total_cad },
//     positions: [ { ticker, base, account, currency, qty, price, cad_value,
//                    position_weight_pct, sleeve, sector,
//                    cost_basis, position_return_pct, ...stopDistanceMetrics } ],
//     sleeves: [ { sleeve, cad_value, sleeve_weight_pct, sleeve_target_pct,
//                  sleeve_variance_pp, sleeve_remaining_capacity_pct } ],
//     sectors: [ { sector, cad_value, sector_weight_pct, positions[] } ],
//     accounts: [ { account_id, account_name, cad_value, account_weight_pct,
//                   position_count, cash_cad, cash_usd } ],
//     cash: { cash_cad_raw, cash_usd_raw, cash_cad_equiv, cash_pct, deployable_cad, deployable_usd },
//     concentration: [ { base, cad_value, weight_pct, level: "clean"|"warn"|"breach" } ],
//     reconciliation: {
//       sum_of_position_weights_pct, sum_of_sleeve_weights_pct,
//       sum_of_account_weights_pct, expected_sum_pct (100 - cash_pct),
//       position_weight_delta_pp, sleeve_weight_delta_pp, account_weight_delta_pp,
//       warnings: [ { code, delta_pp, message } ],
//       passed: boolean
//     }
//   }
export function computeCanonicalPortfolio(profile, opts = {}) {
  if (!profile) return null;
  const asOf = opts.asOf || new Date().toISOString();
  const fx = Number(profile.fxUsdCad) || 1.37;
  const positions = (profile.positions || []).filter(p => p?.ticker && (p.qty > 0));
  const accounts = profile.accounts || [];
  const sleeveTargets = profile.sleeveTargets || null;

  // Cash across accounts. Raw preserves negative (debit) balances so
  // the reconciliation can surface them; deployable clamps to zero.
  let cashCadRaw = 0, cashUsdRaw = 0, deployableCad = 0, deployableUsd = 0;
  const perAccountCash = new Map(); // acct id → { cad, usd }
  for (const a of accounts) {
    const cad = Number(a?.cashCad) || 0;
    const usd = Number(a?.cashUsd) || 0;
    cashCadRaw += cad;
    cashUsdRaw += usd;
    deployableCad += Math.max(0, cad);
    deployableUsd += Math.max(0, usd);
    perAccountCash.set(String(a.id), { cad, usd });
  }
  const cashCadEquiv = cashCadRaw + cashUsdRaw * fx;

  // Book equity from positions (before adding cash). Every position
  // gets its cad_value stamped here and reused everywhere downstream.
  const positionRows = positions.map(p => {
    const cadValue = positionValueCad(p, fx);
    const acct = accounts.find(a => String(a.id) === String(p.acct));
    const stopMetrics = stopDistanceMetrics(p);
    return {
      ticker: p.ticker,
      base: baseTicker(p.ticker),
      account_id: p.acct || null,
      account_name: acct?.name || p.acct || null,
      account_type: acct?.type || null,
      currency: p.ccy || "USD",
      qty: p.qty,
      price: Number.isFinite(p.priceCad) ? p.priceCad : Number.isFinite(p.priceUsd) ? p.priceUsd : null,
      cad_value: cadValue,
      sleeve: classifyPosition(p) || "unclassified",
      sector: (() => { try { return mapTickerToSector(p.ticker) || "Unknown"; } catch { return "Unknown"; } })(),
      cost_basis: p.avgCost ?? p.costBasis ?? null,
      position_return_pct: positionReturnPct(p),
      // Explicitly field-named stop metrics (§24 stop-integrity requirement).
      ...stopMetrics,
    };
  });

  const { sum: bookEquityCad, skipped: skippedPositions } = safeSum(positionRows.map(r => r.cad_value));
  const portfolioTotalCad = bookEquityCad + cashCadEquiv;

  // Position weights. Denominator is portfolioTotal (per spec: "cash
  // must be included consistently"). If portfolio total is 0 (fresh
  // account), weights are all 0 — reconciliation still runs and
  // surfaces "no book" as a warning.
  const positionsCanonical = positionRows.map(r => ({
    ...r,
    position_weight_pct: portfolioTotalCad > 0 ? (r.cad_value / portfolioTotalCad) * 100 : 0,
  }));

  // Sleeves — leverage the existing enforcer but promote every field
  // to the canonical naming, add remaining_capacity, and re-denominate
  // over portfolioTotalCad instead of bookEquityCad (spec: cash is in).
  const enforcerBal = computeSleeveBalance(positions, fx, sleeveTargets);
  const sleeveKeys = ["core", "swing", "income", "spec"];
  const sleevesCanonical = sleeveKeys.map(k => {
    const cad = enforcerBal?.totals?.[k] || 0;
    const weightPct = portfolioTotalCad > 0 ? (cad / portfolioTotalCad) * 100 : 0;
    const targetPct = enforcerBal?.targetsPct?.[k] ?? null;
    return {
      sleeve: k,
      cad_value: cad,
      sleeve_weight_pct: weightPct,
      sleeve_target_pct: targetPct,
      sleeve_variance_pp: targetPct != null ? weightPct - targetPct : null,
      sleeve_remaining_capacity_pct: targetPct != null ? Math.max(0, targetPct - weightPct) : null,
    };
  });

  // Sectors
  const sectorMap = new Map();
  for (const r of positionsCanonical) {
    const sec = r.sector || "Unknown";
    if (!sectorMap.has(sec)) sectorMap.set(sec, { sector: sec, cad_value: 0, positions: [] });
    const entry = sectorMap.get(sec);
    entry.cad_value += r.cad_value;
    entry.positions.push(r.ticker);
  }
  const sectorsCanonical = [...sectorMap.values()].map(s => ({
    ...s,
    sector_weight_pct: portfolioTotalCad > 0 ? (s.cad_value / portfolioTotalCad) * 100 : 0,
  })).sort((a, b) => b.cad_value - a.cad_value);

  // Accounts
  const acctMap = new Map();
  for (const a of accounts) {
    const cashLegs = perAccountCash.get(String(a.id)) || { cad: 0, usd: 0 };
    const cadEquiv = cashLegs.cad + cashLegs.usd * fx;
    acctMap.set(String(a.id), {
      account_id: a.id,
      account_name: a.name || String(a.id),
      account_type: a.type || null,
      currency: a.ccy || null,
      cash_cad: cashLegs.cad,
      cash_usd: cashLegs.usd,
      cash_cad_equiv: cadEquiv,
      position_cad_value: 0,
      position_count: 0,
      cad_value: cadEquiv, // starts with cash; add positions below
    });
  }
  for (const r of positionsCanonical) {
    if (!r.account_id) continue;
    const entry = acctMap.get(String(r.account_id));
    if (!entry) continue;
    entry.position_cad_value += r.cad_value;
    entry.cad_value += r.cad_value;
    entry.position_count += 1;
  }
  const accountsCanonical = [...acctMap.values()].map(a => ({
    ...a,
    account_weight_pct: portfolioTotalCad > 0 ? (a.cad_value / portfolioTotalCad) * 100 : 0,
  })).sort((a, b) => b.cad_value - a.cad_value);

  // Concentration — same-base ticker aggregated across accounts.
  const byBase = new Map();
  for (const r of positionsCanonical) {
    const prev = byBase.get(r.base) || { base: r.base, cad_value: 0, tickers: new Set() };
    prev.cad_value += r.cad_value;
    prev.tickers.add(r.ticker);
    byBase.set(r.base, prev);
  }
  const concentration = [...byBase.values()].map(b => {
    const weightPct = portfolioTotalCad > 0 ? (b.cad_value / portfolioTotalCad) * 100 : 0;
    const level = weightPct >= CONCENTRATION_BREACH_PCT ? "breach"
      : weightPct >= CONCENTRATION_WARN_PCT ? "warn" : "clean";
    return { base: b.base, tickers: [...b.tickers], cad_value: b.cad_value, weight_pct: weightPct, level };
  }).sort((a, b) => b.weight_pct - a.weight_pct);

  // ─── Reconciliation ────────────────────────────────────────────────
  const cashPct = portfolioTotalCad > 0 ? (cashCadEquiv / portfolioTotalCad) * 100 : 0;
  const sumPositionWeights = positionsCanonical.reduce((s, r) => s + r.position_weight_pct, 0);
  const sumSleeveWeights = sleevesCanonical.reduce((s, r) => s + r.sleeve_weight_pct, 0);
  const sumAccountWeights = accountsCanonical.reduce((s, r) => s + r.account_weight_pct, 0);
  const expectedNonCashPct = 100 - cashPct;
  const positionDelta = sumPositionWeights - expectedNonCashPct;
  const sleeveDelta = sumSleeveWeights - expectedNonCashPct;
  const accountDelta = sumAccountWeights - 100; // accounts INCLUDE cash

  const warnings = [];
  if (Math.abs(positionDelta) > ROUNDING_TOLERANCE_PP) {
    warnings.push({ code: "position-weights-not-reconciling", delta_pp: positionDelta,
      message: `Position weights sum to ${sumPositionWeights.toFixed(2)}%, expected ${expectedNonCashPct.toFixed(2)}% (delta ${positionDelta.toFixed(2)}pp)` });
  }
  if (Math.abs(sleeveDelta) > ROUNDING_TOLERANCE_PP) {
    warnings.push({ code: "sleeve-weights-not-reconciling", delta_pp: sleeveDelta,
      message: `Sleeve weights sum to ${sumSleeveWeights.toFixed(2)}%, expected ${expectedNonCashPct.toFixed(2)}% (delta ${sleeveDelta.toFixed(2)}pp)` });
  }
  if (Math.abs(accountDelta) > ROUNDING_TOLERANCE_PP) {
    warnings.push({ code: "account-weights-not-reconciling", delta_pp: accountDelta,
      message: `Account weights sum to ${sumAccountWeights.toFixed(2)}%, expected 100% (delta ${accountDelta.toFixed(2)}pp)` });
  }
  if (portfolioTotalCad <= 0) {
    warnings.push({ code: "empty-portfolio", delta_pp: 0, message: "Portfolio total is 0 CAD — no positions and no cash." });
  }
  if (skippedPositions > 0) {
    warnings.push({ code: "positions-missing-price", delta_pp: 0,
      message: `${skippedPositions} position(s) skipped due to missing price data; weights excluded from sums.` });
  }
  for (const c of concentration) {
    if (c.level === "breach") warnings.push({ code: "concentration-breach", delta_pp: c.weight_pct - CONCENTRATION_BREACH_PCT,
      message: `${c.base} concentration ${c.weight_pct.toFixed(1)}% ≥ ${CONCENTRATION_BREACH_PCT}% breach threshold` });
  }

  const reconciliation = {
    sum_of_position_weights_pct: sumPositionWeights,
    sum_of_sleeve_weights_pct: sumSleeveWeights,
    sum_of_account_weights_pct: sumAccountWeights,
    expected_non_cash_pct: expectedNonCashPct,
    position_weight_delta_pp: positionDelta,
    sleeve_weight_delta_pp: sleeveDelta,
    account_weight_delta_pp: accountDelta,
    tolerance_pp: ROUNDING_TOLERANCE_PP,
    warnings,
    passed: warnings.filter(w => !["positions-missing-price", "empty-portfolio", "concentration-breach"].includes(w.code)).length === 0,
  };

  return {
    asOf,
    fxUsdCad: fx,
    totals: {
      book_cad: bookEquityCad,
      cash_cad_equiv: cashCadEquiv,
      portfolio_total_cad: portfolioTotalCad,
    },
    positions: positionsCanonical.sort((a, b) => b.cad_value - a.cad_value),
    sleeves: sleevesCanonical,
    sectors: sectorsCanonical,
    accounts: accountsCanonical,
    cash: {
      cash_cad_raw: cashCadRaw,
      cash_usd_raw: cashUsdRaw,
      cash_cad_equiv: cashCadEquiv,
      cash_pct: cashPct,
      deployable_cad: deployableCad,
      deployable_usd: deployableUsd,
    },
    concentration,
    reconciliation,
  };
}

// ─── Rec/action lookup helpers ───────────────────────────────────────
// Given a canonical portfolio + a ticker, return the single canonical
// position row for it. Downstream code must use this — not a re-scan
// of profile.positions — so every section sees the same numbers.
export function getCanonicalPosition(canonical, ticker) {
  if (!canonical || !ticker) return null;
  const base = baseTicker(ticker);
  return canonical.positions.find(p => p.base === base) || null;
}

export function getCanonicalSleeve(canonical, sleeve) {
  if (!canonical || !sleeve) return null;
  const key = String(sleeve).toLowerCase();
  return canonical.sleeves.find(s => s.sleeve === key) || null;
}

export function getCanonicalSector(canonical, sector) {
  if (!canonical || !sector) return null;
  return canonical.sectors.find(s => s.sector === sector) || null;
}

export function getCanonicalAccount(canonical, accountId) {
  if (!canonical || !accountId) return null;
  const idStr = String(accountId);
  return canonical.accounts.find(a => String(a.account_id) === idStr) || null;
}
