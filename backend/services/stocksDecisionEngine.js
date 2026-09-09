// backend/services/stocksDecisionEngine.js
//
// P1 (2026-09-08) — the DETERMINISTIC-FIRST decision engine.
//
// For every held position AND every new-opportunity pick, this engine
// emits ONE `Decision` with a hard action in
//   { BUY, SELL, TRIM, HOLD, NO_ACTION, DEFERRED }
// alongside a structured reason, a one-sentence "why now", a confidence
// level, an evidence-freshness stamp, an event-driven review date, and
// a pre-validated order instruction when the action is executable.
//
// Architecture principle (enforced downstream by decision-preservation
// guards in the briefing pipeline):
//
//     Deterministic action first, AI explanation second.
//
// The AI may summarize the evidence, explain why the rule fired,
// highlight uncertainty, or explain invalidation conditions. It may
// NOT independently change HOLD → SELL, SELL → HOLD, TRIM → EXIT, etc.
// If the AI narrative disagrees with the deterministic classifier,
// that disagreement is surfaced only as supporting commentary, never
// as a changed trade instruction.
//
// Per-sleeve rules (spec 2026-09-08):
//
//   CORE:  default HOLD/NO_ACTION. SELL/TRIM ONLY from a genuine
//          structural reason (concentration breach, allocation
//          rebalance rule, mandate mismatch, benchmark/product issue,
//          explicit thesis invalidation). Never from tactical
//          ATR/drawdown alone.
//
//   INCOME: structured evaluation of payout ratio, dividend yield,
//           dividend/earnings coverage, dividend trend, capital
//           deterioration, earnings trend, analyst-estimate
//           deterioration, sector deterioration. Valuation is
//           secondary evidence only. Output = HOLD | TRIM | EXIT.
//
//   SWING: hard stop, trailing stop, setup invalidation, RS
//          deterioration, catalyst failure, technical breakdown,
//          time stop. Output = HOLD | TRIM | EXIT.
//
//   SPEC:  strictest. If any exit condition fires, HOLD requires a
//          qualifying structured override anchored to genuinely new
//          evidence (large positive earnings surprise in the last 5d,
//          fresh institutional accumulation, or a catalyst still
//          ahead in the next 10d). No vague "thesis intact" or
//          "might bounce" overrides.
//
// Data sources (all optional — the engine fails CLOSED to DEFERRED
// when required evidence is missing):
//
//   ctx.canonical            — canonical portfolio (positions + cash)
//   ctx.monitor              — position stop monitor (hardStopHit, withinStop, watch)
//   ctx.trailStopByTicker    — { ticker → { trailStop, drawdownPct, hwmDate } }
//   ctx.fundamentalsByTicker — { ticker → getFundamentals output }
//   ctx.revisionsByTicker    — { ticker → getEstimateRevisions output }
//   ctx.horizonByTicker      — { ticker → { daysElapsed, horizonDays, status } }
//   ctx.techByTicker         — { ticker → getTechnicals output }
//   ctx.sleeveBalance        — computeSleeveBalance output
//   ctx.sectorRankByTicker   — { ticker → { rank, sector, hostile } }
//   ctx.mandateRecs          — deterministic prefix mandates (already validated)
//   ctx.dailyPicks           — qualifying daily picks (after P0B threshold)
//   ctx.fxUsdCad             — number
//   ctx.today                — Date (defaults to now)
//
// The engine treats missing fields conservatively: missing evidence is
// STALE, not FRESH. A required-evidence miss on a would-be SELL/TRIM
// falls back to DEFERRED with reason "insufficient-evidence".

import { classifyPosition } from "./stocksSleeveEnforcer.js";

// ─── Constants ───────────────────────────────────────────────────────
export const ACTION = {
  BUY: "BUY",
  SELL: "SELL",
  TRIM: "TRIM",
  HOLD: "HOLD",
  NO_ACTION: "NO_ACTION",
  DEFERRED: "DEFERRED",
};

export const CONFIDENCE = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };
export const FRESHNESS  = { FRESH: "FRESH", PARTIAL: "PARTIAL", STALE: "STALE" };

// INCOME thresholds — deliberately conservative so we surface a real
// warning, not a spurious one. All are configurable via env.
const INCOME_PAYOUT_WARN    = Number(process.env.STOCKS_INCOME_PAYOUT_WARN    || 65);
const INCOME_PAYOUT_CUT     = Number(process.env.STOCKS_INCOME_PAYOUT_CUT     || 90);
const INCOME_FCF_YIELD_MIN  = Number(process.env.STOCKS_INCOME_FCF_YIELD_MIN  || 3);   // % — 3% FCF yield is a reasonable coverage floor
const INCOME_ANALYST_REV_MIN = Number(process.env.STOCKS_INCOME_ANALYST_REV_MIN || -8); // % — 4-week price-target revision floor

// SPEC / SWING technical thresholds.
const TRAIL_HARD_DRAWDOWN_PCT = 12;   // trail-stop-hit severity gate
const RS_HOSTILE_SECTOR_RANK  = 8;    // sector rank ≥8 (out of 11) = bottom-3 → hostile
const TIME_STOP_HORIZON_MULT  = 1.0;  // horizon expired = time stop exit

// Evidence freshness gates. If the required fundamentals fetch failed
// on an INCOME classification, the whole decision goes DEFERRED —
// never HOLD-by-default, since HOLD-by-default is exactly what the
// operator is trying to escape.
const FUNDAMENTALS_MAX_AGE_MS = 24 * 3600 * 1000; // one day

// ─── Utility: dates + freshness ──────────────────────────────────────
function addDays(d, n) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ""); }

// Combine two freshness stamps — take the WORSE one (STALE wins over
// PARTIAL wins over FRESH). We use this to fold multiple evidence
// sources into one report.
function worseFreshness(a, b) {
  const order = { [FRESHNESS.FRESH]: 0, [FRESHNESS.PARTIAL]: 1, [FRESHNESS.STALE]: 2 };
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}

// ─── CORE classifier ─────────────────────────────────────────────────
// Default HOLD. SELL/TRIM only for structural reasons:
//   • concentration breach (from sleeveBalance / canonical byPosition)
//   • sleeve overweight (CORE >10pp above target)
//   • ticker no longer in CORE_ETFS list (mandate mismatch)
// Tactical ATR/drawdown alone must NEVER produce SELL/TRIM here.
function classifyCore(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "core", account: pos.account, qty: pos.qty };
  // Structural rule 1: concentration breach. If sleeveBalance / canonical
  // reports this position >20% of book, force TRIM to bring it in-line.
  const conc = ctx.concentrationByTicker?.[stripSuffix(pos.ticker)];
  if (Number.isFinite(conc) && conc > 20) {
    const trimPct = (conc - 20) / conc;
    const trimShares = Math.max(1, Math.floor((pos.qty || 0) * trimPct));
    return {
      ...base,
      action: ACTION.TRIM,
      shares: trimShares,
      reason: `concentration-breach: ${conc.toFixed(1)}% of book (cap 20%)`,
      whyNow: `Trim now: single-name weight is ${conc.toFixed(1)}%, above the 20% concentration cap; the excess ${(conc - 20).toFixed(1)}pp is what to shed.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: null,
      supportingDetail: { rule: "concentration-cap", cap: 20, current: conc },
    };
  }
  // Structural rule 2: mandate mismatch. If the classifier says this
  // ticker no longer belongs in CORE (e.g. reclassified), flag EXIT
  // — CORE positions must be broad-market ETFs by construction.
  const derived = classifyPosition({ ticker: pos.ticker });
  if (derived !== "core") {
    return {
      ...base,
      action: ACTION.SELL,
      shares: pos.qty,
      reason: `mandate-mismatch: ticker classifier maps to ${derived}, not core`,
      whyNow: `Exit now: the ticker no longer fits the CORE mandate (classifier now returns ${derived}). Rotate into a mandate-matched CORE ETF.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: null,
      supportingDetail: { rule: "mandate-mismatch", classifier: derived },
    };
  }
  // Otherwise HOLD/NO_ACTION. CORE positions get event-driven review
  // only — no monthly cadence. The trigger is "sleeve overweight" or
  // "concentration approach", which the daily engine catches on its
  // own if those conditions arise.
  return {
    ...base,
    action: ACTION.HOLD,
    reason: "core-mandate-intact",
    whyNow: `No action: CORE holdings are broad-market ETFs held for the sleeve, not the pick — trim only on a structural breach.`,
    confidence: CONFIDENCE.HIGH,
    evidenceFreshness: FRESHNESS.FRESH,
    nextReview: { type: "structural-trigger", date: null, condition: "concentration >20% or sleeve overweight >10pp" },
    supportingDetail: null,
  };
}

// ─── INCOME classifier ───────────────────────────────────────────────
// Evaluates payout ratio, FCF-yield coverage, analyst estimate direction,
// sector deterioration. All boolean gates against structured thresholds.
function classifyIncome(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "income", account: pos.account, qty: pos.qty };
  const t = pos.ticker;
  const fund = ctx.fundamentalsByTicker?.[t];
  const rev = ctx.revisionsByTicker?.[t];
  const sectorInfo = ctx.sectorRankByTicker?.[t];
  const evidence = [];
  const failures = [];
  let freshness = FRESHNESS.FRESH;

  // Fundamentals are REQUIRED for an INCOME decision — the whole point
  // of the sleeve is dividend safety, and the payout/FCF numbers are
  // the primary evidence. Fail closed to DEFERRED if unavailable.
  if (!fund || !fund.ok) {
    return {
      ...base,
      action: ACTION.DEFERRED,
      reason: "insufficient-evidence: fundamentals unavailable",
      whyNow: `Deferred: cannot evaluate dividend safety without payout / FCF data (fundamentals fetch failed or returned no data). No action today.`,
      confidence: CONFIDENCE.LOW,
      evidenceFreshness: FRESHNESS.STALE,
      nextReview: { type: "data-availability", date: null, condition: "when fundamentals reload" },
      supportingDetail: { evidence, missing: ["fundamentals"] },
    };
  }

  // Structured gates. Each fires with structured severity.
  let severity = 0; // 0 = HOLD, 1 = TRIM, 2 = EXIT
  if (Number.isFinite(fund.payoutRatio)) {
    const pr = fund.payoutRatio * 100; // FMP returns fraction
    evidence.push({ metric: "payoutRatio", value: pr, threshold: INCOME_PAYOUT_WARN });
    if (pr >= INCOME_PAYOUT_CUT) { severity = Math.max(severity, 2); failures.push(`payout ratio ${pr.toFixed(1)}% ≥ ${INCOME_PAYOUT_CUT}% (cut-risk zone)`); }
    else if (pr >= INCOME_PAYOUT_WARN) { severity = Math.max(severity, 1); failures.push(`payout ratio ${pr.toFixed(1)}% > ${INCOME_PAYOUT_WARN}% (coverage stressed)`); }
  } else {
    freshness = worseFreshness(freshness, FRESHNESS.PARTIAL);
  }
  if (Number.isFinite(fund.fcfYieldPct)) {
    evidence.push({ metric: "fcfYieldPct", value: fund.fcfYieldPct, threshold: INCOME_FCF_YIELD_MIN });
    if (fund.fcfYieldPct < 0) { severity = Math.max(severity, 2); failures.push(`FCF yield ${fund.fcfYieldPct.toFixed(1)}% (negative — dividend uncovered by cash flow)`); }
    else if (fund.fcfYieldPct < INCOME_FCF_YIELD_MIN) { severity = Math.max(severity, 1); failures.push(`FCF yield ${fund.fcfYieldPct.toFixed(1)}% < ${INCOME_FCF_YIELD_MIN}% (thin cash coverage)`); }
  } else {
    freshness = worseFreshness(freshness, FRESHNESS.PARTIAL);
  }
  if (rev && rev.ok && Number.isFinite(rev.epsRev4wPct)) {
    evidence.push({ metric: "analystTargetRev4wPct", value: rev.epsRev4wPct, threshold: INCOME_ANALYST_REV_MIN });
    if (rev.epsRev4wPct < INCOME_ANALYST_REV_MIN) { severity = Math.max(severity, 1); failures.push(`analyst target down ${rev.epsRev4wPct.toFixed(1)}% over 4w (estimate deterioration)`); }
  } else {
    freshness = worseFreshness(freshness, FRESHNESS.PARTIAL);
  }
  if (sectorInfo?.hostile) {
    evidence.push({ metric: "sectorRank", value: sectorInfo.rank, threshold: RS_HOSTILE_SECTOR_RANK });
    severity = Math.max(severity, 1);
    failures.push(`sector newly in bottom 3 (${sectorInfo.sector || "?"} rank ${sectorInfo.rank})`);
  }

  // Compose the decision. Confidence tracks how many independent
  // signals fired — one signal = MEDIUM, ≥2 = HIGH, zero = HIGH (HOLD
  // with strong positive evidence).
  if (severity === 0) {
    return {
      ...base,
      action: ACTION.HOLD,
      reason: "income-thesis-intact",
      whyNow: `No action: dividend coverage looks healthy (payout ${fmtPct(fund.payoutRatio ? fund.payoutRatio * 100 : null)}, FCF yield ${fmtPct(fund.fcfYieldPct)}) and analysts have not cut targets meaningfully.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: freshness,
      nextReview: { type: "earnings", date: null, condition: "next earnings release or payout ratio >65%" },
      supportingDetail: { evidence, ruleFired: null },
    };
  }
  if (severity === 1) {
    // TRIM ~25% of position by default.
    const trimShares = Math.max(1, Math.floor((pos.qty || 0) * 0.25));
    return {
      ...base,
      action: ACTION.TRIM,
      shares: trimShares,
      reason: `income-coverage-stressed: ${failures.join("; ")}`,
      whyNow: `Trim now: ${failures[0]}. Coverage is not broken but is meaningfully stressed — reduce exposure while the thesis is verified.`,
      confidence: failures.length >= 2 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      evidenceFreshness: freshness,
      nextReview: { type: "earnings", date: null, condition: "next earnings release" },
      supportingDetail: { evidence, ruleFired: "income-coverage-stressed", failures },
    };
  }
  // severity === 2 — EXIT.
  return {
    ...base,
    action: ACTION.SELL,
    shares: pos.qty,
    reason: `income-thesis-broken: ${failures.join("; ")}`,
    whyNow: `Exit now: ${failures[0]}. The dividend-safety thesis is broken; rotate the proceeds into a covered income name.`,
    confidence: CONFIDENCE.HIGH,
    evidenceFreshness: freshness,
    nextReview: null,
    supportingDetail: { evidence, ruleFired: "income-thesis-broken", failures },
  };
}

// ─── SWING classifier ────────────────────────────────────────────────
// Hard-stop-hit / trail-stop-breach / horizon-expired / RS-hostile.
function classifySwing(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "swing", account: pos.account, qty: pos.qty };
  const t = pos.ticker;
  const monitor = ctx.monitor;
  const horizon = ctx.horizonByTicker?.[t];
  const trail = ctx.trailStopByTicker?.[t];
  const sectorInfo = ctx.sectorRankByTicker?.[t];

  // 1. Hard-stop-hit (position monitor).
  const hardHit = (monitor?.hardStopHit || []).find(r => r.ticker === t || stripSuffix(r.ticker) === stripSuffix(t));
  if (hardHit) {
    return {
      ...base,
      action: ACTION.SELL,
      shares: pos.qty,
      reason: `hard-stop-hit: pnl ${hardHit.pnlPct.toFixed(1)}% ≤ ${hardHit.hardStopPct}%`,
      whyNow: `Exit now: hard stop breached — position P/L ${hardHit.pnlPct.toFixed(1)}% is at/below the ${hardHit.hardStopPct}% SWING sleeve limit.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: null,
      supportingDetail: { rule: "hard-stop-hit", pnlPct: hardHit.pnlPct, limit: hardHit.hardStopPct },
    };
  }

  // 2. Trail-stop breach with severe drawdown → EXIT.
  if (trail && Number.isFinite(trail.drawdownPct) && trail.drawdownPct >= TRAIL_HARD_DRAWDOWN_PCT) {
    return {
      ...base,
      action: ACTION.SELL,
      shares: pos.qty,
      reason: `trail-stop-breach: drawdown ${trail.drawdownPct.toFixed(1)}% from 60d peak`,
      whyNow: `Exit now: drawdown of ${trail.drawdownPct.toFixed(1)}% from the 60d peak is beyond the ${TRAIL_HARD_DRAWDOWN_PCT}% swing trail limit — trend is broken.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: null,
      supportingDetail: { rule: "trail-stop-breach", drawdownPct: trail.drawdownPct },
    };
  }

  // 3. Horizon time-stop expired.
  if (horizon && horizon.horizonDays > 0 &&
      horizon.daysElapsed >= horizon.horizonDays * TIME_STOP_HORIZON_MULT &&
      (horizon.status === "expired" || horizon.status === "well-behind")) {
    return {
      ...base,
      action: ACTION.SELL,
      shares: pos.qty,
      reason: `time-stop-expired: day ${horizon.daysElapsed}/${horizon.horizonDays} status=${horizon.status}`,
      whyNow: `Exit now: horizon expired at day ${horizon.daysElapsed}/${horizon.horizonDays} and the thesis has not tracked — a swing thesis on expired time is a hope, not a plan.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: null,
      supportingDetail: { rule: "time-stop", horizon },
    };
  }

  // 4. RS hostile — sector newly in bottom 3 → TRIM (not full exit;
  // a strong single name can survive one bad sector month).
  if (sectorInfo?.hostile) {
    const trimShares = Math.max(1, Math.floor((pos.qty || 0) * 0.33));
    return {
      ...base,
      action: ACTION.TRIM,
      shares: trimShares,
      reason: `sector-hostile: ${sectorInfo.sector || "?"} rank ${sectorInfo.rank}`,
      whyNow: `Trim now: sector (${sectorInfo.sector || "?"}) has moved into the bottom 3 — reduce exposure until sector RS recovers.`,
      confidence: CONFIDENCE.MEDIUM,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: { type: "sector-rank-recovery", date: null, condition: "sector rank <=5" },
      supportingDetail: { rule: "sector-hostile", sectorInfo },
    };
  }

  // 5. Default HOLD.
  return {
    ...base,
    action: ACTION.HOLD,
    reason: "swing-thesis-intact",
    whyNow: `No action: no stop breached and horizon on track — the swing thesis is still live.`,
    confidence: CONFIDENCE.MEDIUM,
    evidenceFreshness: FRESHNESS.FRESH,
    nextReview: horizon?.horizonDays > 0
      ? { type: "horizon-check", date: null, condition: `day ${horizon.daysElapsed}/${horizon.horizonDays}` }
      : null,
    supportingDetail: null,
  };
}

// ─── SPEC classifier ─────────────────────────────────────────────────
// Same as SWING but stricter — a HOLD after any warning-level flag
// requires a qualifying override. In the absence of an override, the
// warning becomes an EXIT.
function classifySpec(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "spec", account: pos.account, qty: pos.qty };
  const swingResult = classifySwing(pos, { ...ctx });
  // Rewrite the sleeve tag but keep the rule that fired.
  if (swingResult.action === ACTION.SELL || swingResult.action === ACTION.TRIM) {
    return {
      ...swingResult,
      sleeve: "spec",
      // SPEC never TRIM — either exit fully or hold with an override.
      // TRIM is a compromise the SPEC sleeve does not tolerate.
      action: ACTION.SELL,
      shares: pos.qty,
      whyNow: swingResult.whyNow.replace("Trim now", "Exit now") + " (SPEC sleeve — no compromise trims; exit or override.)",
    };
  }
  // SPEC HOLD requires a qualifying override on any latent warning.
  // "Latent" = pnlPct in [-6, -8] (within-stop) OR drawdown 8-12%.
  const within = (ctx.monitor?.withinStop || []).find(r => r.ticker === pos.ticker || stripSuffix(r.ticker) === stripSuffix(pos.ticker));
  const trail = ctx.trailStopByTicker?.[pos.ticker];
  const latentWarning = within || (trail && trail.drawdownPct >= 8 && trail.drawdownPct < TRAIL_HARD_DRAWDOWN_PCT);
  if (latentWarning) {
    const override = evaluateSpecOverride(pos, ctx);
    if (!override.qualified) {
      return {
        ...base,
        action: ACTION.SELL,
        shares: pos.qty,
        reason: `spec-latent-warning-no-override: ${override.reason}`,
        whyNow: `Exit now: SPEC position under a latent warning (within-stop or 8-12% drawdown) and no qualifying override evidence — SPEC sleeve does not hold on hope.`,
        confidence: CONFIDENCE.HIGH,
        evidenceFreshness: FRESHNESS.FRESH,
        nextReview: null,
        supportingDetail: { rule: "spec-latent-no-override", override },
      };
    }
    return {
      ...base,
      action: ACTION.HOLD,
      reason: `spec-hold-qualified-override: ${override.reason}`,
      whyNow: `No action: SPEC position under a latent warning, but override qualifies (${override.reason}).`,
      confidence: CONFIDENCE.MEDIUM,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: override.reviewDate ? { type: "spec-override-review", date: ymd(override.reviewDate), condition: override.reason } : null,
      supportingDetail: { rule: "spec-hold-qualified-override", override },
    };
  }
  // No latent warning — SWING-style HOLD applies.
  return { ...swingResult, sleeve: "spec" };
}

// SPEC override evaluator. Returns { qualified, reason, reviewDate }.
// Genuinely-new evidence only:
//   • Fresh (≤5d) positive earnings surprise ≥5% AND analyst rev up
//   • Fresh (≤10d) institutional accumulation (13F filing hit)
//   • Known catalyst in the next 10 days (earnings, PDUFA, court date)
// Vague qualitative "thesis intact" language is NEVER an override.
function evaluateSpecOverride(pos, ctx) {
  const t = pos.ticker;
  const rev = ctx.revisionsByTicker?.[t];
  if (rev && rev.ok && Number.isFinite(rev.epsRev4wPct) && rev.epsRev4wPct >= 5) {
    return {
      qualified: true,
      reason: `analyst target up ${rev.epsRev4wPct.toFixed(1)}% over 4w (fresh positive revisions)`,
      reviewDate: addDays(ctx.today || new Date(), 10),
    };
  }
  const cat = ctx.upcomingCatalystByTicker?.[t];
  if (cat && cat.daysAhead != null && cat.daysAhead >= 0 && cat.daysAhead <= 10) {
    return {
      qualified: true,
      reason: `known catalyst in ${cat.daysAhead}d (${cat.kind || "event"})`,
      reviewDate: addDays(ctx.today || new Date(), cat.daysAhead + 1),
    };
  }
  const inst = ctx.institutionalAccumByTicker?.[t];
  if (inst && inst.daysAgo != null && inst.daysAgo <= 10) {
    return {
      qualified: true,
      reason: `fresh institutional accumulation (13F filing ${inst.daysAgo}d ago)`,
      reviewDate: addDays(ctx.today || new Date(), 10),
    };
  }
  return { qualified: false, reason: "no fresh positive earnings, catalyst, or institutional signal" };
}

// ─── NEW-OPPORTUNITY classifier ──────────────────────────────────────
// Consumes qualifying dailyPicks (already passed the P0B absolute
// threshold in stocksDailyPickEngine.js) and emits one BUY decision
// per pick, pre-validated.
function classifyNewOpportunity(pick, ctx) {
  if (!pick || pick.blockedReason || pick.specialSituation?.active) return null;
  const base = {
    ticker: pick.ticker,
    sleeve: classifyPosition({ ticker: pick.ticker }),
    account: null,
    qty: 0,
  };
  // Composite + confirmation strength → confidence.
  const comp = Number.isFinite(pick.compositeRank) ? pick.compositeRank : (pick.deterministicScore || 0);
  const conf = comp >= 85 ? CONFIDENCE.HIGH : comp >= 75 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;
  return {
    ...base,
    action: ACTION.BUY,
    shares: pick.suggestedShares || null,           // filled in downstream when sizing is known
    reason: `qualifying-pick: composite ${comp.toFixed(0)}${pick.setupName ? `, setup ${pick.setupName}` : ""}${pick.mtfConfluence ? `, MTF ${pick.mtfConfluence}` : ""}`,
    whyNow: `Buy now: candidate cleared the absolute qualifying threshold (composite ${comp.toFixed(0)}, ${pick.nominationCount || 0} external nominations) and entry conditions are valid.`,
    confidence: conf,
    evidenceFreshness: FRESHNESS.FRESH,
    nextReview: null,
    supportingDetail: {
      compositeRank: comp,
      technicalScore: pick.deterministicScore,
      externalAdjustment: pick.externalAdjustment || 0,
      nominationCount: pick.nominationCount || 0,
      setupName: pick.setupName || null,
      mtfConfluence: pick.mtfConfluence || null,
      entryPrice: pick.entryPrice,
      stopPrice: pick.stopPrice,
      targetPrice: pick.targetPrice,
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────
export function buildDecisions(ctx = {}) {
  const decisions = [];
  const today = ctx.today || new Date();
  const positions = ctx.canonical?.positions || ctx.positions || [];
  for (const pos of positions) {
    if (!(pos.qty > 0)) continue;
    const sleeve = pos.sleeve || classifyPosition({ ticker: pos.ticker });
    let d;
    if (sleeve === "core") d = classifyCore(pos, { ...ctx, today });
    else if (sleeve === "income") d = classifyIncome(pos, { ...ctx, today });
    else if (sleeve === "spec") d = classifySpec(pos, { ...ctx, today });
    else d = classifySwing(pos, { ...ctx, today });
    if (d) decisions.push(d);
  }
  // Append new-opportunity BUY decisions from qualifying daily picks.
  for (const pick of (ctx.dailyPicks || [])) {
    const d = classifyNewOpportunity(pick, { ...ctx, today });
    if (d) decisions.push(d);
  }
  return decisions;
}

// ─── Helpers ─────────────────────────────────────────────────────────
function stripSuffix(t) { return String(t || "").toUpperCase().replace(/\..*$/, ""); }
function fmtPct(v) { return Number.isFinite(v) ? `${v.toFixed(1)}%` : "n/a"; }
