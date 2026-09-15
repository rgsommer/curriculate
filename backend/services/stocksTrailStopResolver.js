// backend/services/stocksTrailStopResolver.js
//
// P4.3 (2026-09-14) — deterministic resolver for trail-stop reviews.
//
// The old briefing emitted "TRAIL STOP REVIEW — DJT. Decide today and
// record ONE of EXIT / TIGHTEN / HOLD..." which pushed the decision
// back onto the user. This module removes that homework: it consumes
// the position + trail-stop evidence and returns ONE concrete action:
//   SELL / TRIM / HOLD / TIGHTEN / DEFERRED
// with reasonCodes[], evidence[], invalidationTrigger, nextReviewDate,
// and confidence.
//
// It never asks the user "is the payout safe?" or "has valuation
// compressed?" — those are internal questions to the classifier.
//
// Fail-closed: when a critical input is missing (e.g. INCOME dividend
// coverage), emit DEFERRED with the exact missing field named. Better
// to defer safely than to guess.
//
// This module DOES NOT change trading policy. It re-uses the rule
// constants already frozen in stocksDecisionEngine.js and the same
// income-security-type routing.

import { classifyIncomeSecurityType, INCOME_TYPE } from "./stocksIncomeSecurityType.js";

// Mirror the P1 engine's frozen thresholds so the two agree.
const SPEC_HARD_DRAWDOWN_PCT   = 12;
const SWING_HARD_DRAWDOWN_PCT  = 12;
const SPEC_AT_STOP_TOLERANCE_PCT = 1;    // within 1% of trail-stop → TIGHTEN
const INCOME_TRIM_DRAWDOWN_PCT = 15;
const INCOME_HOLD_DRAWDOWN_PCT = 8;
const REVIEW_HORIZON_DAYS      = 14;

export const ACTION = {
  SELL: "SELL", TRIM: "TRIM", HOLD: "HOLD", TIGHTEN: "TIGHTEN",
  DEFERRED: "DEFERRED",
};

export const CONFIDENCE = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function pctBelow(current, ref) { return ref > 0 ? ((ref - current) / ref) * 100 : null; }

// PUBLIC — resolve ONE trail-stop review to a concrete action.
// Input contract:
//   {
//     ticker, sleeve,                         // CORE|INCOME|SWING|SPEC
//     currency,                                // USD|CAD
//     position: { qty, account, currency },
//     currentPrice,
//     trailStopPrice,                          // 60d-peak - 2.5×ATR
//     peakPrice,                               // 60d high
//     drawdownFromPeakPct,                     // negative pct
//     hardStopHit,                             // bool — position monitor said HARD SELL
//     evidence: { … per-security signals … }, // optional; missing → DEFERRED for INCOME
//     today = new Date(),
//   }
// Output:
//   { action, reasonCodes[], evidence[], invalidationTrigger,
//     nextReviewDate, confidence, sizingHint }
export function resolveTrailStopReview({
  ticker, sleeve, currency,
  position, currentPrice, trailStopPrice, peakPrice, drawdownFromPeakPct,
  hardStopHit = false,
  evidence = {},
  today = new Date(),
}) {
  const sleeveNorm = String(sleeve || "").toLowerCase();
  const dd = Number.isFinite(drawdownFromPeakPct) ? Math.abs(drawdownFromPeakPct) : null;
  const stopBreached = Number.isFinite(currentPrice) && Number.isFinite(trailStopPrice)
    ? currentPrice < trailStopPrice : null;
  const atStop = Number.isFinite(currentPrice) && Number.isFinite(trailStopPrice)
    ? Math.abs(pctBelow(currentPrice, trailStopPrice) ?? 0) <= SPEC_AT_STOP_TOLERANCE_PCT : null;
  const reviewDate = addDays(today, REVIEW_HORIZON_DAYS);

  // Universal short-circuit: hard-stop hit on the position monitor always
  // wins — SELL regardless of sleeve.
  if (hardStopHit) {
    return {
      action: ACTION.SELL,
      reasonCodes: ["hard-stop-hit"],
      evidence: [{ metric: "position.hardStopHit", value: true, source: "positionStopMonitor" }],
      invalidationTrigger: null,
      nextReviewDate: null,
      confidence: CONFIDENCE.HIGH,
      sizingHint: { qty: position?.qty, percent: 100 },
    };
  }

  // ─── CORE sleeve ────────────────────────────────────────────
  // Trail-stop is informational only for long-horizon CORE. HOLD.
  if (sleeveNorm === "core") {
    return {
      action: ACTION.HOLD,
      reasonCodes: ["core-long-horizon"],
      evidence: [
        { metric: "sleeve", value: "core", source: "sleeveEnforcer" },
        { metric: "drawdownFromPeakPct", value: dd, source: "trailStopMonitor" },
      ],
      invalidationTrigger: "structural thesis change (ETF strategy shift or manager departure)",
      nextReviewDate: reviewDate,
      confidence: CONFIDENCE.HIGH,
      sizingHint: null,
    };
  }

  // ─── SPEC sleeve ────────────────────────────────────────────
  if (sleeveNorm === "spec") {
    // Below stop → SELL. At stop → TIGHTEN.
    if (stopBreached === true && (dd == null || dd >= SPEC_HARD_DRAWDOWN_PCT)) {
      return {
        action: ACTION.SELL,
        reasonCodes: ["spec-trail-breach-plus-drawdown"],
        evidence: [
          { metric: "sleeve", value: "spec", source: "sleeveEnforcer" },
          { metric: "stopBreached", value: true, source: "trailStopMonitor" },
          { metric: "drawdownFromPeakPct", value: dd, threshold: SPEC_HARD_DRAWDOWN_PCT, source: "trailStopMonitor" },
        ],
        invalidationTrigger: null,
        nextReviewDate: null,
        confidence: CONFIDENCE.HIGH,
        sizingHint: { qty: position?.qty, percent: 100 },
      };
    }
    if (stopBreached === true) {
      return {
        action: ACTION.SELL,
        reasonCodes: ["spec-trail-breach"],
        evidence: [
          { metric: "sleeve", value: "spec", source: "sleeveEnforcer" },
          { metric: "stopBreached", value: true, source: "trailStopMonitor" },
        ],
        invalidationTrigger: null,
        nextReviewDate: null,
        confidence: CONFIDENCE.MEDIUM,
        sizingHint: { qty: position?.qty, percent: 100 },
      };
    }
    if (atStop === true) {
      return {
        action: ACTION.TIGHTEN,
        reasonCodes: ["spec-at-trail-stop"],
        evidence: [
          { metric: "sleeve", value: "spec", source: "sleeveEnforcer" },
          { metric: "atStop", value: true, source: "trailStopMonitor" },
        ],
        invalidationTrigger: "close below hard stop over 2 consecutive sessions",
        nextReviewDate: addDays(today, 5),
        confidence: CONFIDENCE.MEDIUM,
        sizingHint: null,
      };
    }
    return {
      action: ACTION.HOLD,
      reasonCodes: ["spec-trail-untouched"],
      evidence: [
        { metric: "sleeve", value: "spec", source: "sleeveEnforcer" },
        { metric: "drawdownFromPeakPct", value: dd, threshold: SPEC_HARD_DRAWDOWN_PCT, source: "trailStopMonitor" },
      ],
      invalidationTrigger: `drawdown from 60d peak exceeds ${SPEC_HARD_DRAWDOWN_PCT}%`,
      nextReviewDate: reviewDate,
      confidence: CONFIDENCE.MEDIUM,
      sizingHint: null,
    };
  }

  // ─── SWING sleeve ───────────────────────────────────────────
  if (sleeveNorm === "swing") {
    if (stopBreached === true && (dd == null || dd >= SWING_HARD_DRAWDOWN_PCT)) {
      return {
        action: ACTION.SELL,
        reasonCodes: ["swing-trail-breach-plus-drawdown"],
        evidence: [
          { metric: "sleeve", value: "swing", source: "sleeveEnforcer" },
          { metric: "stopBreached", value: true, source: "trailStopMonitor" },
          { metric: "drawdownFromPeakPct", value: dd, threshold: SWING_HARD_DRAWDOWN_PCT, source: "trailStopMonitor" },
        ],
        invalidationTrigger: null,
        nextReviewDate: null,
        confidence: CONFIDENCE.HIGH,
        sizingHint: { qty: position?.qty, percent: 100 },
      };
    }
    if (stopBreached === true) {
      return {
        action: ACTION.TIGHTEN,
        reasonCodes: ["swing-trail-touched"],
        evidence: [
          { metric: "sleeve", value: "swing", source: "sleeveEnforcer" },
          { metric: "stopBreached", value: true, source: "trailStopMonitor" },
          { metric: "drawdownFromPeakPct", value: dd, threshold: SWING_HARD_DRAWDOWN_PCT, source: "trailStopMonitor" },
        ],
        invalidationTrigger: `close ≥${SWING_HARD_DRAWDOWN_PCT}% below peak on next session`,
        nextReviewDate: addDays(today, 3),
        confidence: CONFIDENCE.MEDIUM,
        sizingHint: null,
      };
    }
    return {
      action: ACTION.HOLD,
      reasonCodes: ["swing-trail-untouched"],
      evidence: [
        { metric: "sleeve", value: "swing", source: "sleeveEnforcer" },
        { metric: "drawdownFromPeakPct", value: dd, threshold: SWING_HARD_DRAWDOWN_PCT, source: "trailStopMonitor" },
      ],
      invalidationTrigger: `close below trail stop $${trailStopPrice?.toFixed(2)}`,
      nextReviewDate: reviewDate,
      confidence: CONFIDENCE.MEDIUM,
      sizingHint: null,
    };
  }

  // ─── INCOME sleeve ──────────────────────────────────────────
  if (sleeveNorm === "income") {
    // The INCOME classifier normally checks dividend coverage,
    // payout-ratio, structural yield compression, sector view. When
    // any of those inputs are missing we DEFER (safer than guessing).
    const critical = ["dividendCoverageRatio", "payoutRatioPct", "sectorViewIntact"];
    const missing = critical.filter(k => !(k in evidence));
    if (missing.length > 0) {
      return {
        action: ACTION.DEFERRED,
        reasonCodes: ["income-evidence-missing"],
        evidence: [
          { metric: "sleeve", value: "income", source: "sleeveEnforcer" },
          { metric: "drawdownFromPeakPct", value: dd, source: "trailStopMonitor" },
          { metric: "missingEvidence", value: missing, source: "evidenceInputs" },
        ],
        invalidationTrigger: null,
        nextReviewDate: addDays(today, 1),
        confidence: CONFIDENCE.LOW,
        sizingHint: null,
        deferredReason: `INCOME thesis requires ${missing.join(", ")}; no trade authorized until refreshed.`,
      };
    }
    // Severe signal → SELL
    if (evidence.dividendCutOrSuspended === true) {
      return {
        action: ACTION.SELL,
        reasonCodes: ["income-dividend-cut"],
        evidence: [
          { metric: "sleeve", value: "income", source: "sleeveEnforcer" },
          { metric: "dividendCutOrSuspended", value: true, source: "dividendMonitor" },
        ],
        invalidationTrigger: null,
        nextReviewDate: null,
        confidence: CONFIDENCE.HIGH,
        sizingHint: { qty: position?.qty, percent: 100 },
      };
    }
    // Small drawdown + coverage intact → HOLD
    if (dd != null && dd <= INCOME_HOLD_DRAWDOWN_PCT
        && Number(evidence.dividendCoverageRatio) >= 1.2
        && Number(evidence.payoutRatioPct) < 80
        && evidence.sectorViewIntact === true) {
      return {
        action: ACTION.HOLD,
        reasonCodes: ["income-thesis-intact"],
        evidence: [
          { metric: "sleeve", value: "income", source: "sleeveEnforcer" },
          { metric: "drawdownFromPeakPct", value: dd, threshold: INCOME_HOLD_DRAWDOWN_PCT, source: "trailStopMonitor" },
          { metric: "dividendCoverageRatio", value: evidence.dividendCoverageRatio, source: "fundamentals" },
          { metric: "payoutRatioPct", value: evidence.payoutRatioPct, source: "fundamentals" },
        ],
        invalidationTrigger: "dividend cut announced OR payout ratio >90% OR drawdown >15%",
        nextReviewDate: reviewDate,
        confidence: CONFIDENCE.HIGH,
        sizingHint: null,
      };
    }
    // Bigger drawdown but thesis still marginally intact → TRIM
    if (dd != null && dd >= INCOME_TRIM_DRAWDOWN_PCT
        && Number(evidence.dividendCoverageRatio) >= 1.0
        && evidence.sectorViewIntact === true) {
      return {
        action: ACTION.TRIM,
        reasonCodes: ["income-drawdown-with-marginal-thesis"],
        evidence: [
          { metric: "sleeve", value: "income", source: "sleeveEnforcer" },
          { metric: "drawdownFromPeakPct", value: dd, threshold: INCOME_TRIM_DRAWDOWN_PCT, source: "trailStopMonitor" },
          { metric: "dividendCoverageRatio", value: evidence.dividendCoverageRatio, source: "fundamentals" },
        ],
        invalidationTrigger: "coverage drops below 1.0 OR sector view breaks",
        nextReviewDate: reviewDate,
        confidence: CONFIDENCE.MEDIUM,
        sizingHint: { qty: Math.floor((position?.qty || 0) / 3), percent: 33 },
      };
    }
    // Sector view broken → SELL
    if (evidence.sectorViewIntact === false) {
      return {
        action: ACTION.SELL,
        reasonCodes: ["income-sector-view-broken"],
        evidence: [
          { metric: "sleeve", value: "income", source: "sleeveEnforcer" },
          { metric: "sectorViewIntact", value: false, source: "sectorRotationMonitor" },
        ],
        invalidationTrigger: null,
        nextReviewDate: null,
        confidence: CONFIDENCE.HIGH,
        sizingHint: { qty: position?.qty, percent: 100 },
      };
    }
    // Middle case → HOLD with review
    return {
      action: ACTION.HOLD,
      reasonCodes: ["income-mid-drawdown-thesis-intact"],
      evidence: [
        { metric: "sleeve", value: "income", source: "sleeveEnforcer" },
        { metric: "drawdownFromPeakPct", value: dd, source: "trailStopMonitor" },
        { metric: "dividendCoverageRatio", value: evidence.dividendCoverageRatio, source: "fundamentals" },
      ],
      invalidationTrigger: "dividend cut, coverage <1.0, or drawdown >20%",
      nextReviewDate: reviewDate,
      confidence: CONFIDENCE.MEDIUM,
      sizingHint: null,
    };
  }

  // Unknown sleeve → fail closed.
  return {
    action: ACTION.DEFERRED,
    reasonCodes: ["unknown-sleeve"],
    evidence: [{ metric: "sleeve", value: sleeve, source: "sleeveEnforcer" }],
    confidence: CONFIDENCE.LOW,
    deferredReason: `Sleeve "${sleeve}" not recognized; no trade authorized.`,
  };
}

// PUBLIC — render a resolved decision as the single sentence Richard reads.
// Never includes "decide today" / "is the payout safe?" homework.
export function renderResolvedDecision(ticker, r, position) {
  const acct = position?.account || position?.acct || "?";
  const qty = position?.qty || r.sizingHint?.qty || 0;
  switch (r.action) {
    case ACTION.SELL:
      return `**${ticker} — SELL ${qty} sh** (${acct}). Reason: ${r.reasonCodes.join(", ")}. Confidence ${r.confidence}.`;
    case ACTION.TRIM: {
      const trimQty = r.sizingHint?.qty || Math.floor(qty / 3);
      return `**${ticker} — TRIM ${trimQty} sh** (${acct}). Reason: ${r.reasonCodes.join(", ")}. Confidence ${r.confidence}.`;
    }
    case ACTION.TIGHTEN:
      return `**${ticker} — TIGHTEN STOP** (${acct}). Reason: ${r.reasonCodes.join(", ")}. Invalidation: ${r.invalidationTrigger}. Review ${r.nextReviewDate}.`;
    case ACTION.HOLD:
      return `**${ticker} — HOLD** (${acct}). Reason: ${r.reasonCodes.join(", ")}. Invalidation: ${r.invalidationTrigger}. Review ${r.nextReviewDate}.`;
    case ACTION.DEFERRED:
      return `**${ticker} — DECISION DEFERRED — DATA REQUIRED**. ${r.deferredReason || "Required evidence unavailable."} No trade authorized until refreshed.`;
    default:
      return `**${ticker} — NO ACTION**.`;
  }
}
