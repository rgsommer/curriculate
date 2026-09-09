// backend/services/stocksDecisionEngine.js
//
// P1 (2026-09-08) — the DETERMINISTIC-FIRST decision engine.
// P1 HARDENING (2026-09-08 patch): per-security-type INCOME rules,
// evidence-stack scoring (no single-soft-signal trades), decision
// provenance, safer CORE mandate-mismatch handling, softer SPEC
// drawdown rule, correct 13F freshness semantics.
//
// For every held position AND every new-opportunity pick, this engine
// emits ONE `Decision` with a hard action in
//   { BUY, SELL, TRIM, HOLD, NO_ACTION, DEFERRED }
// plus:
//   • primaryRule          — the single rule that carried the action
//   • supportingEvidence[] — corroborating signals (each with metric,
//                            value, threshold, weight, source)
//   • contraryEvidence[]   — signals that argued the OTHER direction;
//                            captured so a "trim on 2 warnings" call
//                            includes the healthy indicator it fired
//                            despite, and so P3/P4 alpha attribution
//                            can weigh false-positives correctly
//   • securityType         — for INCOME: bank/reit/utility/… ; the
//                            metric selection depended on this
//   • dataAsOf             — ISO date of the underlying evidence set
//   • confidence           — HIGH / MEDIUM / LOW
//   • evidenceFreshness    — FRESH / PARTIAL / STALE
//   • validatorStatus      — from the mandate/validator gates
//   • engineVersion        — bump on rule changes so historical rows
//                            can be re-evaluated later
//
// Architecture principle (enforced downstream by the AI-contradiction
// guard in the briefing pipeline):
//
//     Deterministic action first, AI explanation second.
//     A deterministic rule must be more trustworthy than the
//     judgment it replaces.
//
// The AI may summarize the evidence, explain why the rule fired,
// highlight uncertainty, or explain invalidation conditions. It may
// NOT independently change HOLD → SELL, SELL → HOLD, TRIM → EXIT.

import { classifyPosition } from "./stocksSleeveEnforcer.js";
import { classifyIncomeSecurityType, INCOME_TYPE } from "./stocksIncomeSecurityType.js";

export const ENGINE_VERSION = "1.1.0"; // 1.0.0 = P1 initial; 1.1.0 = P1 hardening
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

// ─── SWING / SPEC technical thresholds ────────────────────────────────
// TRAIL_HARD_DRAWDOWN_PCT is a first-class SWING exit trigger (breaks
// the trailing-stop discipline). SPEC uses the same trigger BUT no
// longer treats an 8-12% drawdown as an independent "latent warning"
// that becomes a SELL — the P1-hardening spec explicitly rejected
// that arbitrary second hidden stop. SPEC continues to exit hard on:
// hard-stop-hit, trail-stop breach ≥12%, horizon-expired well-behind,
// and setup invalidation flagged externally.
const TRAIL_HARD_DRAWDOWN_PCT = 12;
const TIME_STOP_HORIZON_MULT  = 1.0;

// ─── INCOME evidence-stack thresholds ─────────────────────────────────
// SCORING: each triggered signal contributes points. Aggregate score
// determines action:
//   score  == 0                            → HOLD
//   score  in [1, 2]  AND no severe signal → HOLD  (WATCH — surfaced
//                                                   in supportingEvidence[]
//                                                   but not actionable)
//   score  in [3, 5]  AND no severe signal → TRIM
//   score  >= 6                            → SELL
//   any severe signal                      → SELL immediately (jumps to top)
//
// A "severe signal" is a company-level event that unambiguously
// breaks the thesis on its own:
//   • dividend cut / suspension announced
//   • CET1 or regulatory-capital ratio below minimum (banks)
//   • distribution suspended (REIT)
//   • confirmed going-concern doubt
//
// A "warning signal" is a coverage stress or trend deterioration
// worth flagging but NOT actionable alone:
//   • payout ratio elevated (for the security type)
//   • FCF/AFFO/distributable-cash coverage thin
//   • analyst-target revision materially down
//   • sector newly hostile
//   • CET1 approaching floor
//
// Multiple independent warnings ⇒ TRIM. One warning ⇒ HOLD with the
// evidence surfaced. Zero warnings ⇒ clean HOLD.

const INCOME_ACTION_THRESHOLDS = {
  TRIM_MIN_SCORE: 3,     // needs multiple independent warnings
  SELL_MIN_SCORE: 6,     // OR a severe signal (evaluated separately)
};

// Per-security-type gate thresholds. Reflect the ECONOMIC REALITY
// of each security type instead of a universal FCF/EPS payout rule.
// All numbers are commentary-configurable via env for A/B testing.
const BANK = {
  PAYOUT_WARN:  Number(process.env.STOCKS_INCOME_BANK_PAYOUT_WARN  || 55),   // banks typically pay out 40-55%
  PAYOUT_HIGH:  Number(process.env.STOCKS_INCOME_BANK_PAYOUT_HIGH  || 75),   // above 75% earnings payout is a warning for a bank
  ROE_WARN:     Number(process.env.STOCKS_INCOME_BANK_ROE_WARN     || 8),    // ROE < 8% for a big bank is materially weak
};
const REIT = {
  AFFO_PAYOUT_WARN: Number(process.env.STOCKS_INCOME_REIT_AFFO_WARN || 90),  // REIT AFFO payout warning band 90-100%
  AFFO_PAYOUT_HIGH: Number(process.env.STOCKS_INCOME_REIT_AFFO_HIGH || 105), // > 105% AFFO payout is stressed
};
const UTILITY = {
  PAYOUT_WARN: Number(process.env.STOCKS_INCOME_UTIL_PAYOUT_WARN || 85),     // utilities structurally 60-85%
  PAYOUT_HIGH: Number(process.env.STOCKS_INCOME_UTIL_PAYOUT_HIGH || 100),
};
const PIPELINE = {
  DCF_PAYOUT_WARN: Number(process.env.STOCKS_INCOME_PIPE_DCF_WARN || 90),    // pipelines 65-90% distributable-cash payout
  DCF_PAYOUT_HIGH: Number(process.env.STOCKS_INCOME_PIPE_DCF_HIGH || 105),
};
const TELECOM = {
  PAYOUT_WARN: Number(process.env.STOCKS_INCOME_TELCO_PAYOUT_WARN || 90),    // telcos 70-90% is normal for mature market
  PAYOUT_HIGH: Number(process.env.STOCKS_INCOME_TELCO_PAYOUT_HIGH || 110),
};
const INDUSTRIAL = {
  PAYOUT_WARN: Number(process.env.STOCKS_INCOME_IND_PAYOUT_WARN || 65),      // industrials 30-65%
  PAYOUT_HIGH: Number(process.env.STOCKS_INCOME_IND_PAYOUT_HIGH || 90),
  FCF_YIELD_MIN: Number(process.env.STOCKS_INCOME_IND_FCF_MIN   || 3),       // <3% FCF yield = thin dividend coverage
};

// ─── Utility helpers ─────────────────────────────────────────────────
function stripSuffix(t) { return String(t || "").toUpperCase().replace(/\..*$/, ""); }
function fmtPct(v) { return Number.isFinite(v) ? `${v.toFixed(1)}%` : "n/a"; }
function worseFreshness(a, b) {
  const order = { [FRESHNESS.FRESH]: 0, [FRESHNESS.PARTIAL]: 1, [FRESHNESS.STALE]: 2 };
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}
function addDays(d, n) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ""); }

// Provenance factory — every decision goes through this so downstream
// analytics (P3/P4 alpha attribution) has a uniform shape.
function makeDecision({
  ticker, sleeve, account, qty,
  action, shares = null, orderInstruction = null,
  primaryRule, supportingEvidence = [], contraryEvidence = [],
  securityType = null,
  whyNow, confidence, evidenceFreshness,
  nextReview = null,
  supportingDetail = null,
  dataAsOf,
  validatorStatus = "pending",
}) {
  const reason = primaryRule + (supportingEvidence.length
    ? "; supporting: " + supportingEvidence.map(e => e.summary || `${e.metric}=${e.value}`).join(", ")
    : "");
  return {
    ticker, sleeve, account, qty,
    action, shares, orderInstruction,
    primaryRule,
    supportingEvidence, contraryEvidence,
    securityType,
    reason,          // human-readable summary — kept for existing callers
    whyNow,
    confidence, evidenceFreshness,
    nextReview,
    supportingDetail,
    dataAsOf: dataAsOf || new Date().toISOString(),
    validatorStatus,
    engineVersion: ENGINE_VERSION,
  };
}

// ─── CORE classifier ─────────────────────────────────────────────────
// Default HOLD. Structural SELL/TRIM only:
//   • concentration breach (still automatic — a hard 20% cap is a
//     portfolio-policy violation, not a taxonomy issue)
//   • mandate mismatch is now DEFERRED, not SELL — a classifier or
//     taxonomy change is not automatically an investment-thesis break
//     (P1 hardening rule 7). The operator sees the flag with the old
//     and new classification and decides.
// Tactical ATR/drawdown alone must NEVER produce SELL/TRIM.
function classifyCore(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "core", account: pos.account, qty: pos.qty };
  const dataAsOf = new Date().toISOString();
  const conc = ctx.concentrationByTicker?.[stripSuffix(pos.ticker)];
  if (Number.isFinite(conc) && conc > 20) {
    const trimPct = (conc - 20) / conc;
    const trimShares = Math.max(1, Math.floor((pos.qty || 0) * trimPct));
    return makeDecision({
      ...base,
      action: ACTION.TRIM,
      shares: trimShares,
      primaryRule: `core-concentration-breach: ${conc.toFixed(1)}% of book (cap 20%)`,
      supportingEvidence: [{ metric: "concentrationPct", value: conc, threshold: 20, severity: "structural", summary: `single-name ${conc.toFixed(1)}% of book` }],
      contraryEvidence: [],
      whyNow: `Trim now: single-name weight is ${conc.toFixed(1)}%, above the 20% concentration cap; the excess ${(conc - 20).toFixed(1)}pp is what to shed.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: { type: "structural-trigger", label: "no scheduled review — event driven (concentration re-check on next snapshot)" },
      supportingDetail: { rule: "concentration-cap", cap: 20, current: conc },
      dataAsOf,
    });
  }
  const derived = classifyPosition({ ticker: pos.ticker });
  if (derived !== "core") {
    // P1 hardening rule 7: mandate mismatch is a CLASSIFICATION conflict
    // (taxonomy change / data-provider drift), not a thesis break.
    // DEFER to the operator. Log old vs new so the mismatch is visible.
    console.warn(`[core-mandate-conflict] ${pos.ticker} in account ${pos.account}: classifier now maps to '${derived}' (was 'core'). Deferred — operator decision.`);
    return makeDecision({
      ...base,
      action: ACTION.DEFERRED,
      primaryRule: `core-mandate-classification-conflict: classifier now maps to '${derived}', was 'core'`,
      supportingEvidence: [{ metric: "sleeveClassifier", value: derived, threshold: "core", severity: "structural", summary: `classifier drift from core → ${derived}` }],
      contraryEvidence: [],
      whyNow: `Deferred: classifier now maps this ticker to '${derived}' rather than 'core'. A taxonomy change is not an investment thesis break — operator decides whether to reclassify or exit.`,
      confidence: CONFIDENCE.LOW,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: { type: "operator-decision", label: "manual review — reclassify or exit" },
      supportingDetail: { rule: "core-mandate-classification-conflict", oldClassification: "core", newClassification: derived, reason: "classifier drift" },
      dataAsOf,
    });
  }
  return makeDecision({
    ...base,
    action: ACTION.HOLD,
    primaryRule: "core-mandate-intact",
    supportingEvidence: [],
    contraryEvidence: [],
    whyNow: `No action: CORE holdings are broad-market ETFs held for the sleeve, not the pick — trim only on a structural breach.`,
    confidence: CONFIDENCE.HIGH,
    evidenceFreshness: FRESHNESS.FRESH,
    nextReview: { type: "event-driven", label: "No scheduled review — event driven (concentration >20% or sleeve overweight >10pp)" },
    supportingDetail: null,
    dataAsOf,
  });
}

// ─── INCOME classifier ───────────────────────────────────────────────
// Per-security-type evidence-stack evaluation. See doc header.
function classifyIncome(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "income", account: pos.account, qty: pos.qty };
  const t = pos.ticker;
  const fund = ctx.fundamentalsByTicker?.[t];
  const rev = ctx.revisionsByTicker?.[t];
  const dividendEvent = ctx.dividendEventByTicker?.[t]; // { type: "cut"|"suspend"|"declaration", pct?, when? }
  const dataAsOf = new Date().toISOString();
  const securityType = classifyIncomeSecurityType(t, fund);
  const supportingEvidence = [];
  const contraryEvidence = [];
  let freshness = FRESHNESS.FRESH;
  let score = 0;
  let severeSignal = null;

  // Severe-signal short circuit: a confirmed dividend cut / suspend is
  // an automatic SELL regardless of type.
  if (dividendEvent && (dividendEvent.type === "cut" || dividendEvent.type === "suspend")) {
    severeSignal = {
      metric: "dividendEvent",
      value: dividendEvent.type,
      threshold: null,
      severity: "severe",
      summary: dividendEvent.type === "suspend"
        ? "dividend suspended"
        : `dividend cut ${dividendEvent.pct != null ? `${dividendEvent.pct}%` : ""}`.trim(),
    };
  }

  // ─── Type-appropriate evaluation ───────────────────────────────
  // Each `add(...)` records evidence AND increments score by the
  // signal's weight. Weights encode "how independently strong is this
  // one signal" — a critical severity gets weight 3, warning gets 1.
  const add = (metric, value, threshold, weight, severity, summary) => {
    supportingEvidence.push({ metric, value, threshold, weight, severity, summary });
    score += weight;
  };
  const noteHealthy = (metric, value, summary) => {
    contraryEvidence.push({ metric, value, severity: "healthy", summary });
  };

  // If we have literally no fundamentals AND security type is unknown,
  // fail closed — cannot select appropriate metrics.
  if (!fund || !fund.ok) {
    return makeDecision({
      ...base,
      action: ACTION.DEFERRED,
      primaryRule: "insufficient-evidence: fundamentals unavailable",
      supportingEvidence,
      contraryEvidence,
      securityType,
      whyNow: `Deferred: cannot evaluate dividend safety without security-type-appropriate metrics (fundamentals fetch failed or returned no data). No action today.`,
      confidence: CONFIDENCE.LOW,
      evidenceFreshness: FRESHNESS.STALE,
      nextReview: { type: "data-availability", label: "when fundamentals reload" },
      supportingDetail: { evidence: supportingEvidence, missing: ["fundamentals"] },
      dataAsOf,
    });
  }

  // ─── BANK / FINANCIAL ──────────────────────────────
  if (securityType === INCOME_TYPE.BANK) {
    // Banks: earnings payout ratio matters, but 50-70% is normal —
    // only ≥HIGH threshold or a low ROE contributes. Standard corporate
    // FCF yield is NOT applicable — a bank's cash flow shape is
    // dominated by loan-book / deposit dynamics, not corporate FCF.
    if (Number.isFinite(fund.payoutRatio)) {
      const pr = fund.payoutRatio * 100;
      if (pr >= BANK.PAYOUT_HIGH) {
        add("bankPayoutRatio", pr, BANK.PAYOUT_HIGH, 2, "warning", `bank payout ratio ${pr.toFixed(1)}% ≥ ${BANK.PAYOUT_HIGH}% (elevated for a bank)`);
      } else if (pr >= BANK.PAYOUT_WARN) {
        add("bankPayoutRatio", pr, BANK.PAYOUT_WARN, 1, "watch", `bank payout ratio ${pr.toFixed(1)}% > ${BANK.PAYOUT_WARN}% (mildly elevated)`);
      } else {
        noteHealthy("bankPayoutRatio", pr, `payout ${pr.toFixed(1)}% is comfortable for a bank`);
      }
    } else {
      freshness = worseFreshness(freshness, FRESHNESS.PARTIAL);
    }
    if (Number.isFinite(fund.roeTTM)) {
      if (fund.roeTTM < BANK.ROE_WARN) {
        add("bankROE", fund.roeTTM, BANK.ROE_WARN, 2, "warning", `ROE ${fund.roeTTM.toFixed(1)}% below ${BANK.ROE_WARN}% (weak profitability)`);
      } else {
        noteHealthy("bankROE", fund.roeTTM, `ROE ${fund.roeTTM.toFixed(1)}% (healthy)`);
      }
    }
    // We deliberately do NOT read fund.fcfYieldPct for a bank —
    // conventional corporate FCF yield is not the right dividend-
    // coverage test for a bank. If a CET1 / provisions / credit-loss
    // signal is later wired (ctx.bankCapitalByTicker), it can be
    // scored here as a warning or severe signal.
  }
  // ─── REIT ──────────────────────────────────────────
  else if (securityType === INCOME_TYPE.REIT) {
    // REITs distribute AFFO. If ctx.reitAffoByTicker is available,
    // use AFFO payout; otherwise flag DEFERRED. EPS payout is NOT a
    // valid dividend-safety test for a REIT — reported EPS is depressed
    // by non-cash depreciation, so payout on EPS commonly reads >100%
    // even on well-covered distributions.
    const affo = ctx.reitAffoByTicker?.[t];
    if (affo && Number.isFinite(affo.affoPayoutPct)) {
      const p = affo.affoPayoutPct;
      if (p >= REIT.AFFO_PAYOUT_HIGH) {
        add("reitAffoPayout", p, REIT.AFFO_PAYOUT_HIGH, 3, "warning", `AFFO payout ${p.toFixed(1)}% ≥ ${REIT.AFFO_PAYOUT_HIGH}% (stressed)`);
      } else if (p >= REIT.AFFO_PAYOUT_WARN) {
        add("reitAffoPayout", p, REIT.AFFO_PAYOUT_WARN, 1, "watch", `AFFO payout ${p.toFixed(1)}% (elevated but within band)`);
      } else {
        noteHealthy("reitAffoPayout", p, `AFFO payout ${p.toFixed(1)}% (comfortable)`);
      }
    } else {
      // No AFFO data → PARTIAL freshness. Do NOT fall back to EPS
      // payout for REITs.
      freshness = worseFreshness(freshness, FRESHNESS.PARTIAL);
      // Log EPS payout as CONTRARY-inapplicable so provenance shows
      // we recognized the signal and rejected it as not-appropriate.
      if (Number.isFinite(fund.payoutRatio)) {
        contraryEvidence.push({
          metric: "epsPayoutRatio", value: fund.payoutRatio * 100,
          severity: "inapplicable",
          summary: `EPS payout ${(fund.payoutRatio * 100).toFixed(1)}% is NOT a valid REIT dividend-coverage test (REITs distribute AFFO, not EPS)`,
        });
      }
    }
  }
  // ─── UTILITY / TELECOM ─────────────────────────────
  else if (securityType === INCOME_TYPE.UTILITY || securityType === INCOME_TYPE.TELECOM) {
    const cfg = securityType === INCOME_TYPE.UTILITY ? UTILITY : TELECOM;
    if (Number.isFinite(fund.payoutRatio)) {
      const pr = fund.payoutRatio * 100;
      if (pr >= cfg.PAYOUT_HIGH) {
        add(`${securityType}Payout`, pr, cfg.PAYOUT_HIGH, 3, "warning", `${securityType} payout ${pr.toFixed(1)}% ≥ ${cfg.PAYOUT_HIGH}% (unusually high even for the type)`);
      } else if (pr >= cfg.PAYOUT_WARN) {
        add(`${securityType}Payout`, pr, cfg.PAYOUT_WARN, 1, "watch", `${securityType} payout ${pr.toFixed(1)}% (elevated within type)`);
      } else {
        noteHealthy(`${securityType}Payout`, pr, `${securityType} payout ${pr.toFixed(1)}% (well within band)`);
      }
    }
    // Debt-to-equity as a leverage warning if the fetch surfaced it.
    if (Number.isFinite(fund.debtToEquity) && fund.debtToEquity > 2.5) {
      add("debtToEquity", fund.debtToEquity, 2.5, 1, "watch", `debt/equity ${fund.debtToEquity.toFixed(2)} (elevated leverage)`);
    }
  }
  // ─── PIPELINE ─────────────────────────────────────
  else if (securityType === INCOME_TYPE.PIPELINE) {
    // Pipelines distribute against DCF. If ctx.pipelineDcfByTicker
    // is populated, use it. Else DEFER on coverage (do NOT fall back
    // to EPS payout — same reasoning as REIT).
    const dcf = ctx.pipelineDcfByTicker?.[t];
    if (dcf && Number.isFinite(dcf.dcfPayoutPct)) {
      const p = dcf.dcfPayoutPct;
      if (p >= PIPELINE.DCF_PAYOUT_HIGH) {
        add("pipelineDcfPayout", p, PIPELINE.DCF_PAYOUT_HIGH, 3, "warning", `distributable cash-flow payout ${p.toFixed(1)}% ≥ ${PIPELINE.DCF_PAYOUT_HIGH}% (stressed)`);
      } else if (p >= PIPELINE.DCF_PAYOUT_WARN) {
        add("pipelineDcfPayout", p, PIPELINE.DCF_PAYOUT_WARN, 1, "watch", `distributable cash-flow payout ${p.toFixed(1)}% (elevated but within band)`);
      } else {
        noteHealthy("pipelineDcfPayout", p, `DCF payout ${p.toFixed(1)}% (comfortable)`);
      }
    } else {
      freshness = worseFreshness(freshness, FRESHNESS.PARTIAL);
      if (Number.isFinite(fund.payoutRatio)) {
        contraryEvidence.push({
          metric: "epsPayoutRatio", value: fund.payoutRatio * 100,
          severity: "inapplicable",
          summary: `EPS payout ${(fund.payoutRatio * 100).toFixed(1)}% is NOT a valid pipeline dividend-coverage test (pipelines distribute DCF, not EPS)`,
        });
      }
    }
    if (Number.isFinite(fund.debtToEquity) && fund.debtToEquity > 3.0) {
      add("debtToEquity", fund.debtToEquity, 3.0, 1, "watch", `debt/equity ${fund.debtToEquity.toFixed(2)} (elevated leverage)`);
    }
  }
  // ─── INDUSTRIAL (conventional operating company) ──
  else if (securityType === INCOME_TYPE.INDUSTRIAL) {
    if (Number.isFinite(fund.payoutRatio)) {
      const pr = fund.payoutRatio * 100;
      if (pr >= INDUSTRIAL.PAYOUT_HIGH) {
        add("industrialPayout", pr, INDUSTRIAL.PAYOUT_HIGH, 3, "warning", `payout ${pr.toFixed(1)}% ≥ ${INDUSTRIAL.PAYOUT_HIGH}% (dividend under pressure)`);
      } else if (pr >= INDUSTRIAL.PAYOUT_WARN) {
        add("industrialPayout", pr, INDUSTRIAL.PAYOUT_WARN, 1, "watch", `payout ${pr.toFixed(1)}% above ${INDUSTRIAL.PAYOUT_WARN}% (coverage narrower)`);
      } else {
        noteHealthy("industrialPayout", pr, `payout ${pr.toFixed(1)}% (comfortable)`);
      }
    }
    if (Number.isFinite(fund.fcfYieldPct)) {
      if (fund.fcfYieldPct < 0) {
        add("fcfYieldPct", fund.fcfYieldPct, 0, 3, "warning", `FCF yield ${fund.fcfYieldPct.toFixed(1)}% (NEGATIVE — dividend uncovered by cash flow)`);
      } else if (fund.fcfYieldPct < INDUSTRIAL.FCF_YIELD_MIN) {
        add("fcfYieldPct", fund.fcfYieldPct, INDUSTRIAL.FCF_YIELD_MIN, 1, "watch", `FCF yield ${fund.fcfYieldPct.toFixed(1)}% < ${INDUSTRIAL.FCF_YIELD_MIN}% (thin coverage)`);
      } else {
        noteHealthy("fcfYieldPct", fund.fcfYieldPct, `FCF yield ${fund.fcfYieldPct.toFixed(1)}% (healthy)`);
      }
    }
  }
  // ─── ETF ─────────────────────────────────────────
  else if (securityType === INCOME_TYPE.ETF) {
    // An income ETF's payout ratio number is a portfolio-weighted
    // artifact — not directly meaningful. HOLD by default; only a
    // hard structural signal (fund termination, distribution
    // suspension) could change that, and we don't wire those yet.
    // Report as HEALTHY with metric-inapplicable provenance.
    if (Number.isFinite(fund.payoutRatio)) {
      contraryEvidence.push({
        metric: "epsPayoutRatio", value: fund.payoutRatio * 100,
        severity: "inapplicable",
        summary: `ETF payout ratio ${(fund.payoutRatio * 100).toFixed(1)}% is a portfolio-weighted number and not directly meaningful for the fund itself`,
      });
    }
  }
  // ─── OTHER — fail closed ─────────────────────────
  else {
    return makeDecision({
      ...base,
      action: ACTION.DEFERRED,
      primaryRule: "insufficient-evidence: security type unclassified",
      supportingEvidence, contraryEvidence,
      securityType,
      whyNow: `Deferred: cannot classify security type from ticker or sector data. Refusing to substitute an inappropriate universal metric.`,
      confidence: CONFIDENCE.LOW,
      evidenceFreshness: worseFreshness(freshness, FRESHNESS.PARTIAL),
      nextReview: { type: "operator-decision", label: "manual: name the security type or extend the allowlist" },
      supportingDetail: { securityType, sector: fund?.sector, industry: fund?.industry },
      dataAsOf,
    });
  }

  // ─── Supporting-only signals (never trigger a trade alone) ──
  // Analyst 4w target revision. Even a materially-down revision is
  // logged as CONTEXT only — never independently a TRIM. Contributes
  // +1 score IF the security also has a company-level warning already.
  if (rev && rev.ok && Number.isFinite(rev.epsRev4wPct)) {
    if (rev.epsRev4wPct <= -10) {
      // Only contributes if we're already carrying a company-level
      // warning; otherwise it's context.
      const alreadyWarn = supportingEvidence.some(e => e.severity === "warning");
      if (alreadyWarn) {
        supportingEvidence.push({
          metric: "analystTargetRev4wPct", value: rev.epsRev4wPct, threshold: -10,
          weight: 1, severity: "watch",
          summary: `analyst target down ${rev.epsRev4wPct.toFixed(1)}% (4w) — reinforces existing warning`,
        });
        score += 1;
      } else {
        // Pure context; log as watch but do NOT increment score. The
        // reader sees it in provenance; the classifier does not act.
        supportingEvidence.push({
          metric: "analystTargetRev4wPct", value: rev.epsRev4wPct, threshold: -10,
          weight: 0, severity: "context",
          summary: `analyst target down ${rev.epsRev4wPct.toFixed(1)}% (4w) — CONTEXT ONLY, no other coverage warning fired`,
        });
      }
    } else if (rev.epsRev4wPct >= 5) {
      noteHealthy("analystTargetRev4wPct", rev.epsRev4wPct, `analyst target up ${rev.epsRev4wPct.toFixed(1)}% (4w)`);
    }
  }

  // Sector hostile — CONTEXT ONLY for INCOME. Explicitly rejected as
  // an independent TRIM trigger (P1 hardening rule 4). A healthy
  // dividend company should not be sold because its sector moved into
  // the bottom three this week.
  const sectorInfo = ctx.sectorRankByTicker?.[t];
  if (sectorInfo?.hostile) {
    supportingEvidence.push({
      metric: "sectorHostile", value: sectorInfo.rank ?? "bottom-3",
      threshold: "bottom-3", weight: 0, severity: "context",
      summary: `sector newly hostile (${sectorInfo.sector || "?"}) — INCOME context only, does not independently trigger a trade`,
    });
  }

  // ─── Decide ─────────────────────────────────────────
  if (severeSignal) {
    return makeDecision({
      ...base,
      action: ACTION.SELL,
      shares: pos.qty,
      primaryRule: `income-severe-signal: ${severeSignal.summary}`,
      supportingEvidence: [severeSignal, ...supportingEvidence],
      contraryEvidence,
      securityType,
      whyNow: `Exit now: ${severeSignal.summary}. This is a severe company-level event that alone constitutes a thesis break.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: freshness,
      nextReview: null,
      supportingDetail: { evidence: supportingEvidence, severeSignal, ruleFired: "income-severe-signal", scoreScale: INCOME_ACTION_THRESHOLDS },
      dataAsOf,
    });
  }
  if (score >= INCOME_ACTION_THRESHOLDS.SELL_MIN_SCORE) {
    return makeDecision({
      ...base,
      action: ACTION.SELL,
      shares: pos.qty,
      primaryRule: `income-thesis-broken: evidence score ${score} ≥ ${INCOME_ACTION_THRESHOLDS.SELL_MIN_SCORE} (${securityType})`,
      supportingEvidence, contraryEvidence,
      securityType,
      whyNow: `Exit now: multiple independent coverage warnings on this ${securityType} (aggregate score ${score}). Rotate the proceeds into a covered ${securityType} name.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: freshness,
      nextReview: null,
      supportingDetail: { evidence: supportingEvidence, ruleFired: "income-thesis-broken", score },
      dataAsOf,
    });
  }
  if (score >= INCOME_ACTION_THRESHOLDS.TRIM_MIN_SCORE) {
    const trimShares = Math.max(1, Math.floor((pos.qty || 0) * 0.25));
    // Confidence: HIGH if ≥2 independent WARNING severities fired,
    // MEDIUM if only one warning + one watch, etc.
    const warningCount = supportingEvidence.filter(e => e.severity === "warning").length;
    return makeDecision({
      ...base,
      action: ACTION.TRIM,
      shares: trimShares,
      primaryRule: `income-coverage-deterioration: evidence score ${score} in [${INCOME_ACTION_THRESHOLDS.TRIM_MIN_SCORE}, ${INCOME_ACTION_THRESHOLDS.SELL_MIN_SCORE}) on ${securityType}`,
      supportingEvidence, contraryEvidence,
      securityType,
      whyNow: `Trim now: multiple independent deterioration signals on this ${securityType} (score ${score}). Reduce exposure until the coverage picture verifies.`,
      confidence: warningCount >= 2 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      evidenceFreshness: freshness,
      nextReview: nextEventReview(dividendEvent, "next earnings or dividend declaration"),
      supportingDetail: { evidence: supportingEvidence, ruleFired: "income-coverage-deterioration", score },
      dataAsOf,
    });
  }
  // HOLD (may include watch-level supporting evidence in provenance).
  const watchCount = supportingEvidence.filter(e => e.severity === "watch" || e.severity === "warning").length;
  return makeDecision({
    ...base,
    action: ACTION.HOLD,
    primaryRule: watchCount === 0 ? "income-thesis-intact" : `income-hold-with-watch: score ${score} < TRIM threshold`,
    supportingEvidence, contraryEvidence,
    securityType,
    whyNow: watchCount === 0
      ? `No action: dividend coverage looks appropriate for a ${securityType}.`
      : `No action: one soft warning present but not enough independent signals to trim a ${securityType} holding.`,
    confidence: CONFIDENCE.HIGH,
    evidenceFreshness: freshness,
    nextReview: nextEventReview(dividendEvent, `next earnings or dividend declaration (${securityType})`),
    supportingDetail: { evidence: supportingEvidence, ruleFired: watchCount ? "income-hold-with-watch" : "income-thesis-intact", score },
    dataAsOf,
  });
}

// Compose an event-driven review directive without malformed
// "or earlier if" fragments.
function nextEventReview(dividendEvent, label) {
  return { type: "event-driven", label };
}

// ─── SWING classifier ────────────────────────────────────────────────
function classifySwing(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "swing", account: pos.account, qty: pos.qty };
  const t = pos.ticker;
  const monitor = ctx.monitor;
  const horizon = ctx.horizonByTicker?.[t];
  const trail = ctx.trailStopByTicker?.[t];
  const sectorInfo = ctx.sectorRankByTicker?.[t];
  const dataAsOf = new Date().toISOString();

  const hardHit = (monitor?.hardStopHit || []).find(r => r.ticker === t || stripSuffix(r.ticker) === stripSuffix(t));
  if (hardHit) {
    return makeDecision({
      ...base,
      action: ACTION.SELL, shares: pos.qty,
      primaryRule: `swing-hard-stop-hit: pnl ${hardHit.pnlPct.toFixed(1)}% ≤ ${hardHit.hardStopPct}%`,
      supportingEvidence: [{ metric: "pnlPct", value: hardHit.pnlPct, threshold: hardHit.hardStopPct, weight: 3, severity: "severe", summary: `hard stop breached — pnl ${hardHit.pnlPct.toFixed(1)}%` }],
      contraryEvidence: [],
      whyNow: `Exit now: hard stop breached — position P/L ${hardHit.pnlPct.toFixed(1)}% is at/below the ${hardHit.hardStopPct}% SWING sleeve limit.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      supportingDetail: { rule: "hard-stop-hit", pnlPct: hardHit.pnlPct, limit: hardHit.hardStopPct },
      dataAsOf,
    });
  }
  if (trail && Number.isFinite(trail.drawdownPct) && trail.drawdownPct >= TRAIL_HARD_DRAWDOWN_PCT) {
    return makeDecision({
      ...base,
      action: ACTION.SELL, shares: pos.qty,
      primaryRule: `swing-trail-stop-breach: drawdown ${trail.drawdownPct.toFixed(1)}%`,
      supportingEvidence: [{ metric: "drawdownFrom60dPeakPct", value: trail.drawdownPct, threshold: TRAIL_HARD_DRAWDOWN_PCT, weight: 3, severity: "severe", summary: `drawdown ${trail.drawdownPct.toFixed(1)}% ≥ ${TRAIL_HARD_DRAWDOWN_PCT}%` }],
      contraryEvidence: [],
      whyNow: `Exit now: drawdown of ${trail.drawdownPct.toFixed(1)}% from the 60d peak is beyond the ${TRAIL_HARD_DRAWDOWN_PCT}% swing trail limit — trend is broken.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      supportingDetail: { rule: "trail-stop-breach", drawdownPct: trail.drawdownPct },
      dataAsOf,
    });
  }
  if (horizon && horizon.horizonDays > 0 &&
      horizon.daysElapsed >= horizon.horizonDays * TIME_STOP_HORIZON_MULT &&
      (horizon.status === "expired" || horizon.status === "well-behind")) {
    return makeDecision({
      ...base,
      action: ACTION.SELL, shares: pos.qty,
      primaryRule: `swing-time-stop-expired: day ${horizon.daysElapsed}/${horizon.horizonDays} status=${horizon.status}`,
      supportingEvidence: [{ metric: "horizonStatus", value: horizon.status, threshold: "on-track", weight: 3, severity: "severe", summary: `horizon expired, thesis has not tracked` }],
      contraryEvidence: [],
      whyNow: `Exit now: horizon expired at day ${horizon.daysElapsed}/${horizon.horizonDays} and the thesis has not tracked — a swing thesis on expired time is a hope, not a plan.`,
      confidence: CONFIDENCE.HIGH,
      evidenceFreshness: FRESHNESS.FRESH,
      supportingDetail: { rule: "time-stop", horizon },
      dataAsOf,
    });
  }
  // SWING may respond to sector-relative weakness more than INCOME.
  // Still not automatic-SELL, but a TRIM is appropriate.
  if (sectorInfo?.hostile) {
    const trimShares = Math.max(1, Math.floor((pos.qty || 0) * 0.33));
    return makeDecision({
      ...base,
      action: ACTION.TRIM, shares: trimShares,
      primaryRule: `swing-sector-hostile: ${sectorInfo.sector || "?"} rank ${sectorInfo.rank}`,
      supportingEvidence: [{ metric: "sectorHostile", value: sectorInfo.rank, threshold: "bottom-3", weight: 2, severity: "warning", summary: `sector newly hostile (${sectorInfo.sector || "?"})` }],
      contraryEvidence: [],
      whyNow: `Trim now: sector (${sectorInfo.sector || "?"}) has moved into the bottom 3 — reduce exposure until sector RS recovers.`,
      confidence: CONFIDENCE.MEDIUM,
      evidenceFreshness: FRESHNESS.FRESH,
      nextReview: { type: "event-driven", label: "sector rank recovery to ≤5" },
      supportingDetail: { rule: "sector-hostile", sectorInfo },
      dataAsOf,
    });
  }
  return makeDecision({
    ...base,
    action: ACTION.HOLD,
    primaryRule: "swing-thesis-intact",
    supportingEvidence: [],
    contraryEvidence: [],
    whyNow: `No action: no stop breached and horizon on track — the swing thesis is still live.`,
    confidence: CONFIDENCE.MEDIUM,
    evidenceFreshness: FRESHNESS.FRESH,
    nextReview: horizon?.horizonDays > 0
      ? { type: "horizon-check", label: `horizon check day ${horizon.daysElapsed}/${horizon.horizonDays}` }
      : null,
    dataAsOf,
  });
}

// ─── SPEC classifier ─────────────────────────────────────────────────
// SPEC uses the SAME first-class invalidation set as SWING (hard stop,
// trail-stop breach ≥12%, time stop, sector-hostile). SPEC no longer
// treats an 8-12% drawdown as an INDEPENDENT "latent warning" that
// becomes a SELL unless overridden — that arbitrary second hidden stop
// was rejected by the P1-hardening spec. Percentage drawdown at that
// level surfaces as supporting-evidence context only.
function classifySpec(pos, ctx) {
  const base = { ticker: pos.ticker, sleeve: "spec", account: pos.account, qty: pos.qty };
  const swingResult = classifySwing(pos, ctx);
  // SPEC never TRIMs — collapse SWING TRIM into SELL.
  if (swingResult.action === ACTION.TRIM) {
    return {
      ...swingResult,
      sleeve: "spec",
      action: ACTION.SELL,
      shares: pos.qty,
      whyNow: swingResult.whyNow.replace("Trim now", "Exit now") + " (SPEC sleeve — no compromise trims; exit or hold.)",
      primaryRule: swingResult.primaryRule.replace("swing-", "spec-"),
    };
  }
  if (swingResult.action === ACTION.SELL) {
    return { ...swingResult, sleeve: "spec", primaryRule: swingResult.primaryRule.replace("swing-", "spec-") };
  }
  // For HOLD paths, add drawdown context if we're in the 8-12% band —
  // but do NOT change the action. The invalidation rules above are
  // the authority.
  const trail = ctx.trailStopByTicker?.[pos.ticker];
  const drawdownContext = (trail && Number.isFinite(trail.drawdownPct) && trail.drawdownPct >= 8 && trail.drawdownPct < TRAIL_HARD_DRAWDOWN_PCT)
    ? [{ metric: "drawdownFrom60dPeakPct", value: trail.drawdownPct, threshold: TRAIL_HARD_DRAWDOWN_PCT, weight: 0, severity: "context", summary: `drawdown ${trail.drawdownPct.toFixed(1)}% — within trail limit; context only` }]
    : [];
  return {
    ...swingResult,
    sleeve: "spec",
    supportingEvidence: [...(swingResult.supportingEvidence || []), ...drawdownContext],
  };
}

// ─── NEW OPPORTUNITY classifier ──────────────────────────────────────
function classifyNewOpportunity(pick, ctx) {
  if (!pick || pick.blockedReason || pick.specialSituation?.active) return null;
  const base = {
    ticker: pick.ticker,
    sleeve: classifyPosition({ ticker: pick.ticker }),
    account: null,
    qty: 0,
  };
  const comp = Number.isFinite(pick.compositeRank) ? pick.compositeRank : (pick.deterministicScore || 0);
  const conf = comp >= 85 ? CONFIDENCE.HIGH : comp >= 75 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;
  return makeDecision({
    ...base,
    action: ACTION.BUY,
    shares: pick.suggestedShares || null,
    primaryRule: `qualifying-pick: composite ${comp.toFixed(0)}`,
    supportingEvidence: [
      { metric: "compositeRank", value: comp, weight: 3, severity: "primary", summary: `composite ${comp.toFixed(0)}` },
      ...(pick.setupName ? [{ metric: "setup", value: pick.setupName, weight: 1, severity: "context", summary: `setup ${pick.setupName}` }] : []),
      ...(pick.mtfConfluence ? [{ metric: "mtfConfluence", value: pick.mtfConfluence, weight: 1, severity: "context", summary: `MTF ${pick.mtfConfluence}` }] : []),
      ...(Number.isFinite(pick.nominationCount) && pick.nominationCount > 0 ? [{ metric: "externalNominations", value: pick.nominationCount, weight: 1, severity: "context", summary: `${pick.nominationCount} external nominations` }] : []),
    ],
    contraryEvidence: [],
    whyNow: `Buy now: candidate cleared the absolute qualifying threshold (composite ${comp.toFixed(0)}, ${pick.nominationCount || 0} external nominations) and entry conditions are valid.`,
    confidence: conf,
    evidenceFreshness: FRESHNESS.FRESH,
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
    dataAsOf: new Date().toISOString(),
  });
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
  for (const pick of (ctx.dailyPicks || [])) {
    const d = classifyNewOpportunity(pick, { ...ctx, today });
    if (d) decisions.push(d);
  }
  return decisions;
}
