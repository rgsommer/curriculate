// backend/services/stocksRecValidator.js
//
// Post-generation validator for AI-emitted recommendations. This is the
// "hard gate" layer that converts sleeve / concentration / expectancy /
// price-integrity rules from AI-facing advice (which the AI often
// ignores) into pipeline gates that REJECT violating recs before they
// reach the user.
//
// Called between parseRecsFromBriefing and StocksAdviceRec.insertMany in
// every rec-persist site (briefing cron, send-briefing on-demand,
// finalizeAdvice on the Advice tab). Rejected recs never land in the
// scorecard collection and never appear as actionable cards.
//
// Each rule is an independent function that takes {rec, context} and
// returns {ok: bool, reason?, detail?}. Adding a new gate is one entry
// in the RULES array — the framework runs all of them and aggregates.
//
// Rules currently enforced (highest-leverage first, per Grok's plan):
//   sleeve-spec-cap-hard    — BUY on SPEC when SPEC is at/over cap
//   sleeve-core-widen       — new non-CORE BUY when CORE is >10pp under
//   single-name-cap         — BUY that would push one ticker past 15% of book
//
// Rules NOT yet enforced (data / infrastructure not ready):
//   expectancy-floor        — needs source scorecard to accumulate n≥20
//   regime-hard-gate        — needs regime module wired as input
//   liquidity-floor         — needs per-ticker avg daily volume feed
//   price-integrity         — needs live re-fetch on emit path
//
// Design principles:
//   • Validators are pure functions — no I/O, no DB writes. Callers
//     compose them with whatever context they already have.
//   • Reject-and-log by default. Never mutate the rec. Never partially
//     accept ("size at 0.3× because expectancy is low") — that's the
//     AI's job to reason about, and half-decisions from a validator
//     are worse than a clean reject with a stated reason.
//   • Every rejection carries a machine-readable `reason` slug + a
//     human-readable `detail` so the user can see EXACTLY what got
//     blocked and why (future UI: "rejected recs" section under Advice).

import { classifyPosition } from "./stocksSleeveEnforcer.js";

// Base-ticker normalization — same rule the sleeve enforcer uses so a
// CAD-listed holding and its US ADR aren't treated as separate exposures.
function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// ─────────────────────────────────────────────────────────────────────
// Individual gate functions. Each: (rec, ctx) → { ok, reason?, detail? }
// ─────────────────────────────────────────────────────────────────────

// SPEC over cap is a hard block on any new SPEC BUY. The briefing prompt
// already tells the AI this, but the AI still emits SPEC recs
// occasionally (e.g. the July 31 briefing surfaced ZETA with
// "spec-sleeve already 4.7pp over limit"). The validator refuses
// regardless of AI reasoning.
function ruleSpecCapHard({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const sleeve = classifyPosition({ ticker: rec.ticker });
  if (sleeve !== "spec") return { ok: true };
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct) return { ok: true }; // no context — don't block
  const specPct = bal.actualPct.spec;
  const specTargetPct = bal.targetsPct?.spec ?? 5;
  if (specPct <= specTargetPct) return { ok: true };
  return {
    ok: false,
    reason: "sleeve-spec-cap-hard",
    detail: `SPEC sleeve at ${specPct.toFixed(1)}% is already over the ${specTargetPct}% cap. New SPEC BUYs are hard-blocked until the sleeve shrinks back under target. AI proposed BUY ${rec.ticker} anyway — rejected.`,
  };
}

// A new BUY that isn't CORE while CORE is >10pp under target is exactly
// the wrong direction. Force capital toward CORE until the gap closes
// by at least half. Deliberately loose (10pp not 5pp) so normal drift
// doesn't block every rec, only genuinely lopsided books.
function ruleCoreGapWidening({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct || !bal.targetsPct) return { ok: true };
  const coreGap = bal.targetsPct.core - bal.actualPct.core;
  if (coreGap <= 10) return { ok: true }; // CORE close enough to target
  const sleeve = classifyPosition({ ticker: rec.ticker });
  if (sleeve === "core") return { ok: true }; // BUY IS a CORE ticker — allowed
  return {
    ok: false,
    reason: "sleeve-core-gap-widening",
    detail: `CORE sleeve is ${coreGap.toFixed(1)}pp underweight (${bal.actualPct.core.toFixed(1)}% vs ${bal.targetsPct.core.toFixed(0)}% target). New BUYs on non-CORE tickers widen the imbalance instead of closing it. AI proposed BUY ${rec.ticker} (${sleeve.toUpperCase()}) — rejected. Rotate proceeds into XIU/VUN/XEQT/XBAL first, or wait for CORE gap to close to ≤10pp.`,
  };
}

// A BUY that would push any single base ticker past 15% of book is a
// concentration risk the trader's own risk profile flags but the AI
// doesn't respect. Hard cap.
function ruleSingleNameCap({ rec, ctx }) {
  if (rec.action !== "BUY") return { ok: true };
  const bookCad = ctx.bookCad;
  if (!(bookCad > 0)) return { ok: true };
  const fx = ctx.fxUsdCad || 1.37;
  const positions = ctx.positions || [];
  const base = baseTicker(rec.ticker);
  const existingCad = positions
    .filter(p => baseTicker(p.ticker) === base && (p.qty || 0) > 0)
    .reduce((s, p) => {
      const cad = (Number.isFinite(p.priceCad) ? p.priceCad
        : Number.isFinite(p.priceUsd) ? p.priceUsd * fx : 0) * (p.qty || 0);
      return s + cad;
    }, 0);
  const buyShares = rec.shares || 0;
  const buyPrice = rec.entryPrice || 0;
  if (!(buyShares > 0) || !(buyPrice > 0)) return { ok: true }; // unsized rec — skip
  const buyCad = rec.entryCurrency === "USD" ? buyShares * buyPrice * fx : buyShares * buyPrice;
  const postBuyCad = existingCad + buyCad;
  const postBuyPct = (postBuyCad / bookCad) * 100;
  const CAP_PCT = 15;
  if (postBuyPct <= CAP_PCT) return { ok: true };
  return {
    ok: false,
    reason: "single-name-cap",
    detail: `BUY ${rec.shares} sh ${rec.ticker} @ $${rec.entryPrice} would push the ${base} position to ${postBuyPct.toFixed(1)}% of book (existing ${((existingCad / bookCad) * 100).toFixed(1)}% + ${((buyCad / bookCad) * 100).toFixed(1)}% new), above the ${CAP_PCT}% single-name cap. Downsize the buy or trim the existing lot first.`,
  };
}

const RULES = [
  ruleSpecCapHard,
  ruleCoreGapWidening,
  ruleSingleNameCap,
];

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a single rec against every rule.
 * @param {Object} rec — the parsed rec from parseRecsFromBriefing (has
 *   ticker, action, entryPrice, shares, entryCurrency, etc.)
 * @param {Object} ctx — { positions, sleeveBalance, bookCad, fxUsdCad }
 * @returns {Object} { ok, rejections: [{reason, detail}, ...] }
 */
export function validateRec(rec, ctx) {
  const rejections = [];
  for (const rule of RULES) {
    try {
      const r = rule({ rec, ctx });
      if (!r.ok) rejections.push({ reason: r.reason, detail: r.detail });
    } catch (e) {
      // A buggy validator should never crash the pipeline — log and
      // treat as pass so a rec that would otherwise be legitimate still
      // ships. Better to miss a rejection than lose the whole briefing.
      console.warn(`[rec-validator] rule crashed on ${rec.ticker}:`, e?.message);
    }
  }
  return { ok: rejections.length === 0, rejections };
}

/**
 * Bulk validate. Returns {accepted, rejected} where accepted is the
 * subset of recs safe to persist and rejected is a parallel list of
 * {rec, rejections} for logging / UI display.
 */
export function validateRecs(recs, ctx) {
  const accepted = [];
  const rejected = [];
  for (const rec of recs || []) {
    const r = validateRec(rec, ctx);
    if (r.ok) accepted.push(rec);
    else rejected.push({ rec, rejections: r.rejections });
  }
  if (rejected.length > 0) {
    console.warn(`[rec-validator] rejected ${rejected.length}/${recs.length} recs:`);
    for (const r of rejected) {
      const slugs = r.rejections.map(x => x.reason).join(", ");
      console.warn(`  ${r.rec.action} ${r.rec.ticker}: ${slugs}`);
    }
  }
  return { accepted, rejected };
}

/**
 * Build the ctx object callers need. Convenience for briefing/advice
 * sites so they don't duplicate the same computeSleeveBalance +
 * totalCad + fx wiring.
 */
export function buildValidatorContext({ positions, cashAccounts, fxUsdCad, sleeveTargets, computeSleeveBalance }) {
  const fx = fxUsdCad || 1.37;
  const bookPositions = (positions || []).reduce((s, p) => {
    const cad = (Number.isFinite(p.priceCad) ? p.priceCad
      : Number.isFinite(p.priceUsd) ? p.priceUsd * fx : 0) * (p.qty || 0);
    return s + cad;
  }, 0);
  const bookCash = (cashAccounts || []).reduce(
    (s, a) => s + (a.cashCad || 0) + (a.cashUsd || 0) * fx, 0
  );
  const bookCad = bookPositions + bookCash;
  const sleeveBalance = computeSleeveBalance
    ? computeSleeveBalance(positions || [], fx, sleeveTargets)
    : null;
  return { positions: positions || [], sleeveBalance, bookCad, fxUsdCad: fx };
}
