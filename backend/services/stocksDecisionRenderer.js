// backend/services/stocksDecisionRenderer.js
//
// P1 (2026-09-08) + P1 HARDENING (2026-09-08 patch)
//
// Renders the DECISION CARD at the top of the daily briefing. Answers
//
//     WHAT DO I DO TODAY?
//
// P1 hardening changes:
//   • Review-date rendering is well-formed. No more malformed
//     "Next review: or earlier if ..." fragments. Every review has a
//     first-class `label` string and the renderer emits it verbatim.
//   • Un-validated BUY decisions are NEVER rendered as executable.
//     They move to a distinct "OPPORTUNITY IDENTIFIED — ORDER NOT
//     READY" section below the primary card so the reader cannot
//     confuse a research candidate for a placeable order.
//   • CORE HOLD renders "No scheduled review — event driven" instead
//     of a padded conditional.
//   • DEFERRED cards are visually distinct — no action, no confidence
//     mask — the operator needs to see them so they know a decision
//     could not be made rather than assume all-quiet.
//   • The card excludes noise: no sector-rotation commentary, no
//     factor tables, no alternative ETFs, no technical diagnostics,
//     no research homework. Those belong under the fold.

const ACTION_BADGES = {
  BUY:       "🔵",
  SELL:      "🔴",
  TRIM:      "🟡",
  HOLD:      "🟢",
  NO_ACTION: "⚪",
  DEFERRED:  "⚠️",
};

const ACTION_LABEL = {
  BUY:       "BUY",
  SELL:      "SELL",
  TRIM:      "TRIM",
  HOLD:      "HOLD",
  NO_ACTION: "NO ACTION",
  DEFERRED:  "ACTION DEFERRED — DATA INSUFFICIENT",
};

const ACTION_ORDER = { SELL: 0, TRIM: 1, BUY: 2, DEFERRED: 3, HOLD: 4, NO_ACTION: 5 };
const CONFIDENCE_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function sortDecisions(decisions) {
  return [...(decisions || [])].sort((a, b) => {
    const oa = ACTION_ORDER[a.action] ?? 99;
    const ob = ACTION_ORDER[b.action] ?? 99;
    if (oa !== ob) return oa - ob;
    const ca = CONFIDENCE_ORDER[a.confidence] ?? 99;
    const cb = CONFIDENCE_ORDER[b.confidence] ?? 99;
    if (ca !== cb) return ca - cb;
    return String(a.ticker || "").localeCompare(String(b.ticker || ""));
  });
}

// P1 HARDENING: well-formed review-date rendering. Every review has a
// `.label` — a single, human-readable, complete phrase. No conditional
// prefixes, no "or earlier if" glue with empty fields.
function renderReviewLine(review) {
  if (!review) return "";
  const label = String(review.label || "").trim();
  if (!label) return "";
  return `> Next review: ${label}`;
}

function isPrimaryActionable(d) {
  // A decision qualifies for the PRIMARY card only if it has a
  // hard action AND has passed validation. Un-validated BUY moves
  // to the secondary "opportunity identified" section.
  if (d.action === "DEFERRED") return true;
  if (d.action === "SELL" || d.action === "TRIM") {
    return d.validated !== false;
  }
  if (d.action === "BUY") {
    return d.validated === true;
  }
  return false;
}

function isUnvalidatedOpportunity(d) {
  return d.action === "BUY" && d.validated !== true;
}

function renderValidationBadge(d) {
  if (d.action === "DEFERRED") return "";
  if (d.validated === false) {
    const failures = (d.validationFailures || []).join("; ") || "no failure detail";
    return `\n> ⚠ **NOT VALIDATED** — do not place: ${failures}`;
  }
  return "";
}

function renderPrimaryCard(d) {
  const badge = ACTION_BADGES[d.action] || "•";
  const label = ACTION_LABEL[d.action] || d.action;
  const parts = [];
  const shareStr = (d.shares != null && d.shares > 0 && d.action !== "HOLD" && d.action !== "NO_ACTION")
    ? ` ${d.shares} sh`
    : "";
  const acctStr = d.account ? ` (${d.account})` : "";
  parts.push(`### ${badge} ${d.ticker} — ${label}${shareStr}${acctStr}`);
  if (d.orderInstruction) parts.push(`> Order: ${d.orderInstruction}`);
  if (d.whyNow) parts.push(`> **Why now:** ${d.whyNow}`);
  if (d.primaryRule) parts.push(`> Rule: \`${d.primaryRule}\``);
  const conf = d.confidence ? `confidence ${d.confidence}` : "";
  const fresh = d.evidenceFreshness ? `evidence ${d.evidenceFreshness}` : "";
  const stype = d.securityType && d.sleeve === "income" ? `type ${d.securityType}` : "";
  const meta = [conf, fresh, stype].filter(Boolean).join(" · ");
  if (meta) parts.push(`> ${meta}`);
  const reviewLine = renderReviewLine(d.nextReview);
  if (reviewLine) parts.push(reviewLine);
  const vb = renderValidationBadge(d);
  if (vb) parts.push(vb);
  return parts.join("\n");
}

// Secondary section — an OPPORTUNITY IDENTIFIED card. Clearly labeled
// as non-actionable so the reader does not confuse it for a validated
// order.
function renderOpportunityCard(d) {
  const parts = [];
  const acctStr = d.account ? ` (${d.account})` : "";
  parts.push(`### 🔎 ${d.ticker} — OPPORTUNITY IDENTIFIED · ORDER NOT READY${acctStr}`);
  if (d.whyNow) parts.push(`> **Signal:** ${d.whyNow}`);
  if (d.primaryRule) parts.push(`> Rule: \`${d.primaryRule}\``);
  const conf = d.confidence ? `confidence ${d.confidence}` : "";
  const fresh = d.evidenceFreshness ? `evidence ${d.evidenceFreshness}` : "";
  const meta = [conf, fresh].filter(Boolean).join(" · ");
  if (meta) parts.push(`> ${meta}`);
  const failures = (d.validationFailures || []).filter(Boolean);
  const detail = failures.length ? failures.join("; ") : "sizing / account selection / cash / currency / concentration checks did not complete before render";
  parts.push(`> ⚠ **NOT executable today** — ${detail}. Card will render as BUY once the order pipeline validates.`);
  return parts.join("\n");
}

function renderHoldSummary(holds) {
  if (!holds || holds.length === 0) return "";
  const bySleeve = new Map();
  for (const h of holds) {
    const s = String(h.sleeve || "?").toLowerCase();
    if (!bySleeve.has(s)) bySleeve.set(s, []);
    bySleeve.get(s).push(h.ticker);
  }
  const parts = [];
  for (const [sleeve, tickers] of bySleeve) {
    tickers.sort();
    parts.push(`${sleeve.toUpperCase()}: ${tickers.join(", ")}`);
  }
  return `> ${holds.length} position${holds.length === 1 ? "" : "s"} — no action required. ${parts.join(" · ")}`;
}

// PUBLIC — render the decision card. `decisions` is Decision[] from
// stocksDecisionEngine.buildDecisions.
export function renderDecisionCard(decisions, ctx = {}) {
  const sorted = sortDecisions(decisions);
  const primary       = sorted.filter(isPrimaryActionable);
  const opportunities = sorted.filter(isUnvalidatedOpportunity);
  const holds         = sorted.filter(d => !isPrimaryActionable(d) && !isUnvalidatedOpportunity(d));

  const lines = [];
  lines.push("## 🎯 TODAY'S DECISIONS");
  lines.push("");

  if (primary.length === 0) {
    lines.push("### 🟢 NO TRADES REQUIRED TODAY");
    lines.push("");
    if (holds.length > 0) {
      const summary = renderHoldSummary(holds);
      if (summary) lines.push(summary);
    } else {
      lines.push("> No held positions and no new qualifying opportunities.");
    }
    if (holds.length > 0) {
      lines.push("");
      lines.push("<details><summary>Show per-position review schedule</summary>");
      lines.push("");
      for (const h of holds) {
        const rev = renderReviewLine(h.nextReview);
        const label = rev ? rev.replace(/^> ?/, "") : "No scheduled review — event driven.";
        lines.push(`- **${h.ticker}** [${(h.sleeve || "?").toUpperCase()}] — ${h.primaryRule || h.reason || "hold"}. ${label}`);
      }
      lines.push("");
      lines.push("</details>");
    }
  } else {
    for (const d of primary) {
      lines.push(renderPrimaryCard(d));
      lines.push("");
    }
    if (holds.length > 0) {
      lines.push("---");
      lines.push("");
      const summary = renderHoldSummary(holds);
      if (summary) lines.push(summary);
    }
  }

  if (opportunities.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("### 🔎 Opportunities identified — orders not yet ready");
    lines.push("");
    for (const d of opportunities) {
      lines.push(renderOpportunityCard(d));
      lines.push("");
    }
    lines.push("> Opportunities listed here have passed the quantitative qualifying threshold but have not completed the executable pipeline (sizing → account → cash/proceeds → currency → concentration → sleeve → contradiction). They will appear as BUY on a future briefing once all gates pass.");
  }

  return lines.join("\n");
}

// PUBLIC — serialize decisions for the AI prompt so it can reference
// the exact deterministic verdict per ticker WITHOUT changing the action.
export function serializeDecisionsForAi(decisions) {
  const rows = (decisions || []).map(d => ({
    ticker: d.ticker,
    sleeve: d.sleeve,
    action: d.action,
    shares: d.shares || null,
    primaryRule: d.primaryRule || d.reason,
    securityType: d.securityType || null,
    confidence: d.confidence,
    evidenceFreshness: d.evidenceFreshness,
    validated: d.validated ?? null,
  }));
  return JSON.stringify(rows, null, 0);
}
