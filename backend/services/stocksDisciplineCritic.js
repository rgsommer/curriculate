// backend/services/stocksDisciplineCritic.js
//
// Post-generation discipline audit for the daily briefing. After Claude
// writes the briefing (and the local price validator has had its pass),
// we send it through a small, fast OpenAI model (gpt-4o-mini by
// default) with a strict yes/no checklist:
//
//   1. Any SELL/TRIM/EXIT without a cited trigger?
//   2. Any ticker in the recommendations that isn't in the holdings
//      table or the discovery pool?
//   3. Any current-price claim >10% off from a listed reference?
//   4. Any recommendation directly contradicting yesterday's briefing
//      without a stated new trigger?
//   5. Any "SELL AT MARKET / DELISTED / NOT FOUND" card for a held
//      ticker? (this should never happen after 7bf49f73, but the critic
//      is a belt-and-suspenders check)
//
// Returns a list of specific violations. Caller decides whether to
// prepend a banner or block send.
//
// Gated by:
//   - OPENAI_API_KEY env var (falls through to noop if unset)
//   - STOCKS_CRITIC_ENABLED=1 (default off; opt-in per deploy)
//   - STOCKS_CRITIC_MODEL (default "gpt-4o-mini" — cheap and fast)
//
// Cost: ~$0.01-0.02 per briefing at ~2K input + 500 output tokens on
// gpt-4o-mini. Latency: 1-3s.

const DEFAULT_MODEL = process.env.STOCKS_CRITIC_MODEL || "gpt-4o-mini";

function buildCriticPrompt({ markdown, holdings, horizonRows, previousCalls }) {
  const held = (holdings || []).map(p => `${p.ticker} (${p.qty || 0} sh, ${p.ccy})`).join(", ");
  const horizon = (horizonRows || []).length > 0
    ? horizonRows.map(r => `${r.ticker}: day ${r.daysElapsed}/${r.horizonDays}, ${r.status}`).join("; ")
    : "(no open rec horizons in flight)";
  const prior = previousCalls ? previousCalls.slice(0, 3000) : "(no prior briefing on file)";

  return `You are a strict discipline auditor for a personal stock-advice email. You do NOT rewrite the email. You RETURN a JSON list of specific violations. If none, return an empty list. Do not add commentary; do not editorialize.

RUBRIC (apply strictly — flag ONLY things that clearly violate):

1. Unjustified TRIM / SELL / EXIT of a held position. A TRIM or EXIT is INVALID unless it cites AT LEAST ONE stated trigger: target hit, stop breached, horizon expired, well-behind pace ≥60% of horizon, or specific NEW information (earnings surprise, downgrade to Sell, regulatory action, macro regime flip, breaking news). Language like "capture gains", "de-risk", "lock in profits", "sell into strength", "trim into weekend", "protect capital" WITHOUT a specific trigger is a violation.

2. Ticker mentioned as a recommendation (BUY / SELL / TRIM / EXIT / ADD / new position) that is NOT in the holdings table AND NOT in the discovery pool. Only flag NEW-idea recs that reference unknown tickers.

3. Current-price claim on a held ticker that is materially different (>10%) from what the holdings table shows. Only flag price statements that a reasonable trader would read as an alarming discrepancy.

4. Recommendation directly contradicting yesterday's briefing without naming a specific NEW trigger. "HOLD → EXIT" on the same ticker overnight requires a stated reason.

5. Any "SELL AT MARKET", "DELISTED", "NOT FOUND", "CANNOT BE TRACKED", or similar liquidation card for a ticker in the holdings table. This is never valid.

INPUT:

HOLDINGS TABLE: ${held || "(empty)"}

OPEN REC HORIZONS: ${horizon}

YESTERDAY'S PER-TICKER CALLS (excerpt):
${prior}

TODAY'S BRIEFING (audit this):
${markdown.slice(0, 12000)}

OUTPUT — respond with ONLY a JSON object of the shape:
{"violations": [{"rule": 1-5, "ticker": "TICKER" | null, "quote": "the exact phrase from the briefing", "reason": "why this violates the rule"}]}

If no violations, respond with {"violations": []}. Do not include any other text.`;
}

async function callOpenAI(prompt, model) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.warn(`[discipline-critic] openai ${r.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed?.violations) ? parsed.violations : [];
    } catch (e) {
      console.warn("[discipline-critic] JSON parse failed:", e?.message, content.slice(0, 200));
      return null;
    }
  } catch (e) {
    clearTimeout(tid);
    console.warn("[discipline-critic] fetch failed:", e?.message);
    return null;
  }
}

// Public API: run the critic. Returns { violations, ranBackground } or
// { violations: [], skipped: <reason> } if disabled/unconfigured. Never
// throws — a critic failure must not block the briefing.
export async function runDisciplineCritic({ markdown, holdings, horizonRows, previousCalls }) {
  // Per-user opt-in is enforced by the caller (auditBriefingWithCritic
  // checks portfolio.disciplineCriticEnabled). Here we only enforce the
  // hard preconditions: OPENAI_API_KEY must be set on the deploy, and
  // the briefing must be substantive enough to audit.
  if (!process.env.OPENAI_API_KEY) {
    return { violations: [], skipped: "no-openai-key" };
  }
  if (!markdown || typeof markdown !== "string" || markdown.length < 200) {
    return { violations: [], skipped: "briefing-too-short" };
  }
  try {
    const prompt = buildCriticPrompt({ markdown, holdings, horizonRows, previousCalls });
    const violations = await callOpenAI(prompt, DEFAULT_MODEL);
    if (!Array.isArray(violations)) return { violations: [], skipped: "critic-error" };
    // Filter out anything that doesn't include a rule number and a
    // non-empty quote — hallucinated meta-violations without evidence
    // are noise.
    const filtered = violations.filter(v =>
      v && typeof v.rule === "number" && v.rule >= 1 && v.rule <= 5
      && typeof v.quote === "string" && v.quote.trim().length > 0
    );
    return { violations: filtered.slice(0, 10), ranBackground: false };
  } catch (e) {
    console.warn("[discipline-critic] unexpected failure:", e?.message);
    return { violations: [], skipped: "critic-error" };
  }
}

// Format the violations as an amber banner to prepend to the briefing
// markdown. Empty string if no violations. Keeps the phrasing tight so
// the trader can act on it fast.
export function formatCriticBanner(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return "";
  const ruleNames = {
    1: "Unjustified TRIM/EXIT",
    2: "Unknown ticker",
    3: "Price discrepancy",
    4: "Reverses yesterday without trigger",
    5: "Liquidation card on held ticker",
  };
  const lines = [
    `> ⚠️ **Discipline audit — ${violations.length} issue${violations.length === 1 ? "" : "s"} flagged.** Read before acting. The AI was independently reviewed by a second model against the plan-discipline rubric.`,
    ">",
  ];
  for (const v of violations) {
    const label = ruleNames[v.rule] || `Rule ${v.rule}`;
    const tk = v.ticker ? ` (${v.ticker})` : "";
    const q = String(v.quote || "").slice(0, 140).replace(/\s+/g, " ");
    const why = String(v.reason || "").slice(0, 200).replace(/\s+/g, " ");
    lines.push(`> - **${label}${tk}**: "${q}" — ${why}`);
  }
  lines.push(">");
  return lines.join("\n") + "\n\n";
}
