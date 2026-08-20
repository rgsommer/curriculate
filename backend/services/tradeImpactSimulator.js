// backend/services/tradeImpactSimulator.js
//
// Phase 5 of the Stocks Advisor rewrite (spec §24 Trade Impact
// Simulation):
//
//   "Before recommending a trade, calculate the portfolio AFTER the
//    proposed trade. For every BUY, ADD, TRIM or SELL calculate:
//      • portfolio weight before / after
//      • sleeve weight before / after
//      • sector weight before / after
//      • cash before / after
//    Reject recommendations that violate configured portfolio limits."
//
// Given the canonical portfolio (from portfolioCalcEngine) + a
// proposed trade, this module returns a full before/after diff and
// a violations[] list. The pre-send audit and validator both use this
// to prevent recs from landing when the pro-forma breaks a limit.
//
// Deterministic; no I/O. Pure function of (canonical, trade).

import { computeCanonicalPortfolio, CONCENTRATION_BREACH_PCT, CONCENTRATION_WARN_PCT } from "./portfolioCalcEngine.js";

// Configured limits — kept module-local for now; migrate to
// profile.riskLimits in a future slice so users can tune them.
export const LIMITS = {
  SINGLE_NAME_MAX_PCT: 20,          // hard concentration cap per ticker
  SLEEVE_OVERSHOOT_TOLERANCE_PP: 2, // sleeve can be N pp over target without extra pairing
  SECTOR_MAX_PCT: 35,               // no more than 35% in a single sector
  CASH_FLOOR_PCT: 2,                // never deploy so much cash we go below 2%
};

// baseTicker locally so we're not coupled to another module's copy.
function baseOf(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Apply a single trade to a shallow-cloned profile and return the
// resulting profile. Handles BUY / ADD / TRIM / SELL / EXIT. The
// trade must specify at minimum { ticker, action, shares, entryPrice,
// entryCurrency, account, sleeve }.
export function applyTradeToProfile(profile, trade) {
  if (!profile || !trade) return profile;
  const fx = Number(profile.fxUsdCad) || 1.37;
  const positions = [...(profile.positions || []).map(p => ({ ...p }))];
  const accounts = (profile.accounts || []).map(a => ({ ...a }));

  const shares = Number(trade.shares) || 0;
  const price = Number(trade.entryPrice) || 0;
  const ccy = trade.entryCurrency || "USD";
  const acctId = trade.account || null;
  if (shares <= 0 || price <= 0) return profile;
  const grossLocal = shares * price;
  const grossCad = ccy === "USD" ? grossLocal * fx : grossLocal;

  const action = String(trade.action || "").toUpperCase();
  const isBuy = action === "BUY" || action === "ADD";
  const isSell = action === "SELL" || action === "TRIM" || action === "EXIT";
  if (!isBuy && !isSell) return profile;

  // Adjust cash in the trade's target account first. If no account
  // specified, drop the impact on the first account of matching ccy
  // — this is best-effort, callers should specify account.
  const acct = accounts.find(a => String(a.id) === String(acctId))
    || accounts.find(a => a.ccy === ccy)
    || accounts[0];
  if (acct) {
    if (ccy === "CAD") acct.cashCad = (acct.cashCad || 0) + (isBuy ? -grossLocal : grossLocal);
    else acct.cashUsd = (acct.cashUsd || 0) + (isBuy ? -grossLocal : grossLocal);
  }

  // Position mutation. Match on (base, account) — a rec on RY in
  // RRSP is a distinct position from RY in Non-Spousal.
  const base = baseOf(trade.ticker);
  const targetPositionIdx = positions.findIndex(p =>
    baseOf(p.ticker) === base && String(p.acct) === String(acctId || (acct?.id))
  );
  if (isBuy) {
    if (targetPositionIdx === -1) {
      // Open a new lot.
      positions.push({
        ticker: trade.ticker,
        acct: acctId || acct?.id,
        ccy,
        qty: shares,
        avgCost: price,
        [ccy === "USD" ? "priceUsd" : "priceCad"]: price,
      });
    } else {
      const p = positions[targetPositionIdx];
      const oldQty = p.qty || 0;
      const oldAvg = p.avgCost || p.costBasis || price;
      const newQty = oldQty + shares;
      p.qty = newQty;
      p.avgCost = newQty > 0 ? ((oldQty * oldAvg) + (shares * price)) / newQty : price;
      if (ccy === "USD") p.priceUsd = price; else p.priceCad = price;
    }
  } else {
    // SELL / TRIM / EXIT
    if (targetPositionIdx !== -1) {
      const p = positions[targetPositionIdx];
      const oldQty = p.qty || 0;
      const newQty = Math.max(0, oldQty - shares);
      if (newQty === 0) {
        positions.splice(targetPositionIdx, 1);
      } else {
        p.qty = newQty;
        // Keep avgCost — FIFO/avg-cost accounting is not the sim's job.
      }
    }
  }

  return { ...profile, positions, accounts };
}

// Compute a full before/after diff for a proposed trade. Returns:
//   {
//     before:   { canonical portfolio object }
//     after:    { canonical portfolio object }
//     trade:    { ...normalized trade... }
//     deltas:   {
//       cash_cad_equiv_pp, cash_pct_pp,
//       position: { weight_before, weight_after, delta_pp },
//       sleeve:   { key, weight_before, weight_after, target, variance_before, variance_after },
//       sector:   { key, weight_before, weight_after },
//       concentration: [ ... ]
//     }
//     violations: [ { code, severity: "warn"|"block", message } ]
//   }
export function simulateTradeImpact(profile, trade, opts = {}) {
  if (!profile || !trade) return null;
  const before = computeCanonicalPortfolio(profile);
  const afterProfile = applyTradeToProfile(profile, trade);
  const after = computeCanonicalPortfolio(afterProfile);
  if (!before || !after) return null;

  const base = baseOf(trade.ticker);
  const findPositionByBase = (canonical) => canonical.positions.find(p => p.base === base);
  const posBefore = findPositionByBase(before);
  const posAfter = findPositionByBase(after);

  const sleeve = trade.sleeve ? String(trade.sleeve).toLowerCase() : (posAfter?.sleeve || posBefore?.sleeve);
  const sleeveBefore = before.sleeves.find(s => s.sleeve === sleeve) || null;
  const sleeveAfter = after.sleeves.find(s => s.sleeve === sleeve) || null;

  const sector = posAfter?.sector || posBefore?.sector || null;
  const sectorBefore = sector ? before.sectors.find(s => s.sector === sector) : null;
  const sectorAfter = sector ? after.sectors.find(s => s.sector === sector) : null;

  const violations = [];

  // Concentration violation — never let a single-name breach 20%.
  if (posAfter) {
    if (posAfter.position_weight_pct > LIMITS.SINGLE_NAME_MAX_PCT) {
      violations.push({
        code: "concentration-breach-after-trade",
        severity: "block",
        message: `After ${trade.action} ${trade.ticker}: ${posAfter.position_weight_pct.toFixed(2)}% > ${LIMITS.SINGLE_NAME_MAX_PCT}% single-name cap`,
      });
    } else if (posAfter.position_weight_pct > CONCENTRATION_WARN_PCT) {
      violations.push({
        code: "concentration-warn-after-trade",
        severity: "warn",
        message: `After ${trade.action} ${trade.ticker}: ${posAfter.position_weight_pct.toFixed(2)}% ≥ ${CONCENTRATION_WARN_PCT}% warn threshold`,
      });
    }
  }

  // Sleeve overshoot — BUY that pushes a sleeve past target +
  // tolerance is a block unless the batch has a paired trim.
  if (sleeveAfter && sleeveAfter.sleeve_target_pct != null && (trade.action === "BUY" || trade.action === "ADD")) {
    const overshootPp = sleeveAfter.sleeve_weight_pct - sleeveAfter.sleeve_target_pct;
    if (overshootPp > LIMITS.SLEEVE_OVERSHOOT_TOLERANCE_PP) {
      violations.push({
        code: "sleeve-overshoot-after-trade",
        severity: "block",
        message: `After ${trade.action} ${trade.ticker}: sleeve="${sleeve}" ${sleeveAfter.sleeve_weight_pct.toFixed(2)}% (target ${sleeveAfter.sleeve_target_pct}%, tolerance ${LIMITS.SLEEVE_OVERSHOOT_TOLERANCE_PP}pp)`,
      });
    }
  }

  // Sector cap — no sector > SECTOR_MAX_PCT.
  if (sectorAfter && sectorAfter.sector_weight_pct > LIMITS.SECTOR_MAX_PCT) {
    violations.push({
      code: "sector-cap-after-trade",
      severity: "block",
      message: `After ${trade.action} ${trade.ticker}: sector="${sector}" ${sectorAfter.sector_weight_pct.toFixed(2)}% > ${LIMITS.SECTOR_MAX_PCT}% max`,
    });
  }

  // Cash floor — BUY that drops cash % below floor.
  if ((trade.action === "BUY" || trade.action === "ADD") && after.cash.cash_pct < LIMITS.CASH_FLOOR_PCT) {
    violations.push({
      code: "cash-floor-after-trade",
      severity: "block",
      message: `After ${trade.action} ${trade.ticker}: cash ${after.cash.cash_pct.toFixed(2)}% < ${LIMITS.CASH_FLOOR_PCT}% floor`,
    });
  }

  // Negative cash — the account had less cash than the trade needed.
  const acctAfter = after.accounts.find(a => String(a.account_id) === String(trade.account));
  if (acctAfter && (acctAfter.cash_cad < 0 || acctAfter.cash_usd < 0)) {
    violations.push({
      code: "negative-cash-in-account",
      severity: "block",
      message: `After ${trade.action} ${trade.ticker}: account "${acctAfter.account_name}" would have negative cash (cad=${acctAfter.cash_cad.toFixed(2)}, usd=${acctAfter.cash_usd.toFixed(2)})`,
    });
  }

  return {
    before,
    after,
    trade,
    deltas: {
      cash_cad_equiv_delta: after.cash.cash_cad_equiv - before.cash.cash_cad_equiv,
      cash_pct_delta_pp: after.cash.cash_pct - before.cash.cash_pct,
      position: posAfter ? {
        weight_before_pct: posBefore?.position_weight_pct ?? 0,
        weight_after_pct: posAfter.position_weight_pct,
        delta_pp: posAfter.position_weight_pct - (posBefore?.position_weight_pct ?? 0),
      } : null,
      sleeve: sleeveAfter ? {
        sleeve,
        weight_before_pct: sleeveBefore?.sleeve_weight_pct ?? 0,
        weight_after_pct: sleeveAfter.sleeve_weight_pct,
        target_pct: sleeveAfter.sleeve_target_pct,
        variance_before_pp: sleeveBefore?.sleeve_variance_pp ?? null,
        variance_after_pp: sleeveAfter.sleeve_variance_pp,
      } : null,
      sector: sectorAfter ? {
        sector,
        weight_before_pct: sectorBefore?.sector_weight_pct ?? 0,
        weight_after_pct: sectorAfter.sector_weight_pct,
      } : null,
    },
    violations,
    passed: violations.filter(v => v.severity === "block").length === 0,
  };
}

// Simulate a batch of trades applied in order. Each trade sees the
// portfolio-after-prior-trades so paired TRIM+BUY compositions are
// evaluated as a whole. Returns per-trade results and a final canonical.
export function simulateBatch(profile, trades) {
  const results = [];
  let current = profile;
  for (const trade of trades || []) {
    const step = simulateTradeImpact(current, trade);
    if (!step) { results.push(null); continue; }
    results.push(step);
    current = applyTradeToProfile(current, trade);
  }
  return {
    perTrade: results,
    finalCanonical: computeCanonicalPortfolio(current),
    batchPassed: results.every(r => !r || r.passed),
  };
}
