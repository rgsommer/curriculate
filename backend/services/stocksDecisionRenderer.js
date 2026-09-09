// backend/services/stocksDecisionRenderer.js
//
// P1 (2026-09-08) — renders the DECISION CARD at the top of the daily
// briefing. Answers ONE question in <30 seconds:
//
//     WHAT DO I DO TODAY?
//
// Consumes Decision[] from stocksDecisionEngine.buildDecisions and
// emits a markdown block that goes ABOVE every other briefing section.
//
// Rendering rules:
//   • BUY / SELL / TRIM / DEFERRED rise to the top (actionable).
//   • HOLD / NO_ACTION collapse into ONE line at the bottom when none
//     of them individually needs a review-date callout.
//   • When zero actionable decisions exist, render a dominant
//     "🟢 NO TRADES REQUIRED TODAY" state and elide the individual
//     HOLD list entirely (expandable behind a subtle summary line).
//   • Every actionable card carries WHY NOW (one sentence), the
//     confidence stamp, and the evidence-freshness stamp.
//   • DEFERRED cards are visually distinct — no action, no confidence
//     — the operator needs to see them so they know a decision could
//     not be made rather than assume all-quiet.
//
// Deliberately does NOT include: sector-rotation commentary, factor
// tables, alternative ETFs, technical diagnostics, research homework.
// Those live under the fold in later briefing sections. The card is
// pure signal.

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

// Ranking: actionable first, then deferred (surface but non-executable),
// then HOLD/NO_ACTION last. Within each action bucket, sort by
// confidence (HIGH first) so the most reliable calls are on top.
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

function renderReviewLine(review) {
  if (!review) return "";
  const bits = [];
  if (review.date) bits.push(`by ${review.date}`);
  if (review.condition) bits.push(`or earlier if ${review.condition}`);
  if (review.type && !review.date && !review.condition) bits.push(review.type);
  return bits.length ? `> Next review: ${bits.join(" ")}` : "";
}

function isActionable(d) {
  return d.action === "BUY" || d.action === "SELL" || d.action === "TRIM" || d.action === "DEFERRED";
}

// Every actionable card must be validated before it is rendered as
// executable. If the validation report on the decision shows a
// failure, the card renders in a WARNING state ("NOT VALIDATED —
// resolve before placing") so the operator does not act on it.
function renderValidationBadge(d) {
  if (!isActionable(d) || d.action === "DEFERRED") return "";
  if (d.validated === false) {
    const failures = (d.validationFailures || []).join("; ") || "no failure detail";
    return `\n> ⚠ **NOT VALIDATED** — do not place: ${failures}`;
  }
  if (d.validated === true) return "";
  // Undefined validated = renderer was called before validation ran.
  // Surface conservatively.
  return `\n> ⚠ **Order not yet validated** — do not place until validation completes.`;
}

function renderActionableCard(d) {
  const badge = ACTION_BADGES[d.action] || "•";
  const label = ACTION_LABEL[d.action] || d.action;
  const parts = [];
  // Header line: badge, ticker, action label, share count (BUY/SELL/TRIM only)
  const shareStr = (d.shares != null && d.shares > 0 && d.action !== "HOLD" && d.action !== "NO_ACTION")
    ? ` ${d.shares} sh`
    : "";
  const acctStr = d.account ? ` (${d.account})` : "";
  parts.push(`### ${badge} ${d.ticker} — ${label}${shareStr}${acctStr}`);
  // Body
  if (d.orderInstruction) {
    parts.push(`> Order: ${d.orderInstruction}`);
  }
  if (d.whyNow) {
    parts.push(`> **Why now:** ${d.whyNow}`);
  }
  if (d.reason && d.reason !== d.whyNow) {
    parts.push(`> Rule: \`${d.reason}\``);
  }
  const conf = d.confidence ? `confidence ${d.confidence}` : "";
  const fresh = d.evidenceFreshness ? `evidence ${d.evidenceFreshness}` : "";
  const meta = [conf, fresh].filter(Boolean).join(" · ");
  if (meta) parts.push(`> ${meta}`);
  const reviewLine = renderReviewLine(d.nextReview);
  if (reviewLine) parts.push(reviewLine);
  const vb = renderValidationBadge(d);
  if (vb) parts.push(vb);
  return parts.join("\n");
}

function renderHoldSummary(holds) {
  // Group by sleeve for compact display. A caller who wants the full
  // per-ticker list can look under the §2 Positions section.
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
  const actionable = sorted.filter(isActionable);
  const holds      = sorted.filter(d => !isActionable(d));

  const lines = [];
  lines.push("## 🎯 TODAY'S DECISIONS");
  lines.push("");

  if (actionable.length === 0) {
    lines.push("### 🟢 NO TRADES REQUIRED TODAY");
    lines.push("");
    if (holds.length > 0) {
      const summary = renderHoldSummary(holds);
      if (summary) lines.push(summary);
    } else {
      lines.push("> No held positions and no new qualifying opportunities.");
    }
    // Expandable-detail hint. In markdown-rendered clients that
    // support <details>, this collapses; otherwise it's a short note.
    lines.push("");
    lines.push("<details><summary>Show per-position review dates</summary>");
    lines.push("");
    for (const h of holds) {
      const rev = renderReviewLine(h.nextReview);
      lines.push(`- **${h.ticker}** [${(h.sleeve || "?").toUpperCase()}] — ${h.reason || "hold"}${rev ? `. ${rev.replace(/^> ?/, "")}` : ""}`);
    }
    lines.push("");
    lines.push("</details>");
    return lines.join("\n");
  }

  for (const d of actionable) {
    lines.push(renderActionableCard(d));
    lines.push("");
  }

  if (holds.length > 0) {
    lines.push("---");
    lines.push("");
    const summary = renderHoldSummary(holds);
    if (summary) lines.push(summary);
  }

  return lines.join("\n");
}

// PUBLIC — render a compact machine-readable JSON view of the decisions
// so the AI prompt can reference the exact deterministic verdict per
// ticker. The AI can quote the reason but cannot change the action.
export function serializeDecisionsForAi(decisions) {
  const rows = (decisions || []).map(d => ({
    ticker: d.ticker,
    sleeve: d.sleeve,
    action: d.action,
    shares: d.shares || null,
    reason: d.reason,
    confidence: d.confidence,
    evidenceFreshness: d.evidenceFreshness,
    validated: d.validated ?? null,
  }));
  return JSON.stringify(rows, null, 0);
}
