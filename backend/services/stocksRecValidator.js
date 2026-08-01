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
//   sleeve-spec-cap-hard              — BUY on SPEC when SPEC is at/over cap
//   sleeve-core-widen                 — new non-CORE BUY when CORE is >10pp under
//   single-name-cap                   — BUY that would push one ticker past 15% of book
//   sell-no-redeploy-core-underweight — SELL/TRIM with no companion BUY when
//                                       CORE is >10pp under (batch rule — freed
//                                       cash would widen the sleeve gap)
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
// Batch-level rules. Run over the FULL list of already-per-rec-accepted
// recs and can reject individual recs based on sibling context (e.g. a
// SELL without any companion BUY in the same batch when CORE is
// underweight — the freed cash would compound the sleeve gap).
//
// Each batch rule: (recs, ctx) → [ { recIndex, reason, detail }, ... ]
// where recIndex is the position of the offending rec in the input
// array. validateRecs applies these rejections after per-rec rules.
// ─────────────────────────────────────────────────────────────────────

// A discretionary SELL/TRIM that arrives at the validator was authored
// by the AI (mandatory hard-stop SELLs are pre-rendered in the briefing
// prefix and never round-trip through <RECS>). When CORE is >10pp
// under target, that SELL MUST be paired with a companion BUY in the
// same batch — otherwise the freed cash sits idle and the CORE gap
// widens. The rule doesn't inspect ticker names on the redeploy
// (matching "Cash source: from ENB SELL" prose would require passing
// the raw briefing text through, which the parser doesn't preserve);
// it enforces the weaker "must have SOME BUY" invariant, and relies on
// ruleCoreGapWidening to force that companion BUY to be a CORE ticker.
// The composition is deliberate — one rule ensures redeployment,
// another ensures the redeployment lands on the correct sleeve.
function ruleBatchPairedRedeploy(recs, ctx) {
  const bal = ctx.sleeveBalance;
  if (!bal || !bal.actualPct || !bal.targetsPct) return [];
  const coreGap = bal.targetsPct.core - bal.actualPct.core;
  // Rule only fires when CORE is meaningfully underweight. If CORE is
  // already close to target, naked SELLs are fine — cash accumulation
  // doesn't compound a gap that doesn't exist.
  if (coreGap <= 10) return [];

  const sells = recs.map((r, i) => ({ r, i }))
    .filter(x => x.r.action === "SELL" || x.r.action === "TRIM");
  if (sells.length === 0) return [];

  const buys = recs.filter(r => r.action === "BUY");
  if (buys.length > 0) return []; // batch has a redeploy destination — allowed

  return sells.map(({ r, i }) => ({
    recIndex: i,
    reason: "sell-no-redeploy-core-underweight",
    detail: `${r.action} ${r.ticker} has no companion BUY in the same batch, but CORE is ${coreGap.toFixed(1)}pp underweight — the freed cash would compound the sleeve gap. Either pair this SELL with a CORE BUY (XEQT / VUN / XIU) in the SAME account and currency, or drop the SELL until a redeploy target is defined. AI proposed a naked ${r.action} — rejected.`,
  }));
}

const BATCH_RULES = [
  ruleBatchPairedRedeploy,
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
 *
 * Two-phase: per-rec rules first (drop obvious violators before batch
 * analysis), then batch rules on the survivors. A rec that survives
 * per-rec validation but fails a batch rule moves from accepted →
 * rejected with the batch rule's reason attached.
 */
export function validateRecs(recs, ctx) {
  const perRecAccepted = [];
  const perRecAcceptedIdx = []; // parallel array of original indices
  const rejected = [];
  const originalRecs = recs || [];
  for (let i = 0; i < originalRecs.length; i++) {
    const rec = originalRecs[i];
    const r = validateRec(rec, ctx);
    if (r.ok) { perRecAccepted.push(rec); perRecAcceptedIdx.push(i); }
    else rejected.push({ rec, rejections: r.rejections });
  }

  // Batch phase — rules operate on the full per-rec-accepted list.
  // recIndex in each batch rejection is relative to perRecAccepted.
  const batchRejectionsByIdx = new Map(); // localIdx → [{reason, detail}, ...]
  for (const rule of BATCH_RULES) {
    try {
      const results = rule(perRecAccepted, ctx) || [];
      for (const rej of results) {
        if (!Number.isInteger(rej.recIndex)) continue;
        if (!batchRejectionsByIdx.has(rej.recIndex)) batchRejectionsByIdx.set(rej.recIndex, []);
        batchRejectionsByIdx.get(rej.recIndex).push({ reason: rej.reason, detail: rej.detail });
      }
    } catch (e) {
      console.warn(`[rec-validator] batch rule crashed:`, e?.message);
    }
  }

  const accepted = [];
  for (let localIdx = 0; localIdx < perRecAccepted.length; localIdx++) {
    const rec = perRecAccepted[localIdx];
    const rejs = batchRejectionsByIdx.get(localIdx);
    if (rejs && rejs.length > 0) rejected.push({ rec, rejections: rejs });
    else accepted.push(rec);
  }

  if (rejected.length > 0) {
    console.warn(`[rec-validator] rejected ${rejected.length}/${originalRecs.length} recs:`);
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
