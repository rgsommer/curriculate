// backend/services/stocksDecisionCard.js
//
// P4.3 (2026-09-14) — the "WHAT DO I DO TODAY?" top-of-briefing card.
//
// Richard opens the briefing and within ~10 seconds knows exactly
// what he should do. Everything else in the briefing is optional
// reading.
//
// Rules for what appears here:
//   • ONE line per held ticker for which the deterministic classifier
//     produced a non-NO_ACTION decision, OR that the trail-stop
//     monitor / hard-stop monitor flagged for review.
//   • Executable actions only: SELL / TRIM / BUY / TIGHTEN STOP.
//   • HOLD lines are allowed IFF a review was triggered and resolved
//     to HOLD — this closes the loop for the reader.
//   • DECISION DEFERRED appears verbatim; never re-labeled.
//   • Every line ends with account + qty for SELL/TRIM/BUY, plain
//     reason for HOLD/TIGHTEN.
//   • Bottom of card: NEW BUY line — the deterministic scanner's
//     concrete BUY count today, or "NONE" if no qualifying pick.

const ACTION_ORDER = ["SELL", "TRIM", "TIGHTEN", "HOLD", "DECISION_DEFERRED", "BUY"];

// PUBLIC — build the card lines. Pure function. Returns an array of
// {ticker, action, oneLiner, priority} entries + a summary.
export function buildDecisionCard({ resolvedReviews = [], newBuyCount = 0, hardStopSells = [], deferredNotes = [] } = {}) {
  const entries = [];
  for (const s of hardStopSells) {
    entries.push({
      ticker: s.ticker, account: s.account, qty: s.qty,
      action: "SELL", oneLiner: `${s.ticker} SELL ${s.qty}  (hard stop hit — ${s.account})`,
      priority: 0,
    });
  }
  for (const r of resolvedReviews) {
    entries.push({
      ticker: r.ticker, account: r.account, qty: r.qty,
      action: r.action, oneLiner: renderCardLine(r),
      priority: ACTION_ORDER.indexOf(r.action) >= 0 ? ACTION_ORDER.indexOf(r.action) : 99,
    });
  }
  // Sort by (priority, ticker) so SELLs cluster at top.
  entries.sort((a, b) => a.priority - b.priority || a.ticker.localeCompare(b.ticker));

  const newBuyLine = newBuyCount > 0
    ? `NEW BUY   ${newBuyCount} qualifying pick${newBuyCount === 1 ? "" : "s"} — see §Today's picks`
    : `NEW BUY   NONE`;

  return {
    entries,
    newBuyLine,
    deferredNotes,
    markdown: renderMarkdown(entries, newBuyLine, deferredNotes),
  };
}

function renderCardLine(r) {
  const acct = r.account || "?";
  const qty = r.qty || r.sizingHint?.qty || 0;
  const trimQty = r.sizingHint?.qty || Math.floor(qty / 3);
  switch (r.action) {
    case "SELL":     return `${r.ticker.padEnd(7)} SELL ${qty}  (${acct})`;
    case "TRIM":     return `${r.ticker.padEnd(7)} TRIM ${trimQty}  (${acct})`;
    case "TIGHTEN":  return `${r.ticker.padEnd(7)} TIGHTEN STOP  (${acct})`;
    case "HOLD":     return `${r.ticker.padEnd(7)} HOLD  (${acct}) — review ${r.nextReviewDate}`;
    case "DECISION_DEFERRED":
    case "DEFERRED": return `${r.ticker.padEnd(7)} DECISION DEFERRED — ${r.deferredReason || "data required"}`;
    default:         return `${r.ticker.padEnd(7)} ${r.action}`;
  }
}

function renderMarkdown(entries, newBuyLine, deferredNotes) {
  const lines = [];
  lines.push("## 🧭 WHAT DO I DO TODAY?");
  lines.push("");
  if (entries.length === 0) {
    lines.push("```");
    lines.push("NO POSITION ACTIONS TODAY");
    lines.push(newBuyLine);
    lines.push("```");
    lines.push("");
    lines.push("_Everything below is context. If nothing above changes, you have nothing to do today._");
    return lines.join("\n");
  }
  lines.push("```");
  for (const e of entries) lines.push(e.oneLiner);
  lines.push(newBuyLine);
  lines.push("```");
  if (deferredNotes.length > 0) {
    lines.push("");
    for (const n of deferredNotes) lines.push(`_${n}_`);
  }
  lines.push("");
  lines.push("_Everything below is evidence for the decisions above — optional reading._");
  return lines.join("\n");
}
