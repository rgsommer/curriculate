// backend/services/careersJustificationScorer.js
//
// AI-scored justification quality for the Careers task type (CAREERS_TASK_PLAN.md §11).
// Returns a quality tier 1 (basic), 2 (good), or 3 (excellent), used by the
// submit handler to map to participation / justification / strong_justification.
//
// Uses Anthropic's Haiku-class model. Heuristic fallback (length + multi-dimension
// keyword scan) if the API call fails — never blocks submission.

const BAN_TERMS = /\b(stupid|dumb|loser|idiot|trash|worthless|lazy)\b/i;
const SPECIFICITY_HINTS = /\b(because|specifically|noticed|saw|remember|prefer|strength|skill|experience|tradeoff|tradeoffs|trade.off|trade.offs|cost|salary|flexibility|stress|enjoy|hate|love)\b/i;

function _heuristicScore(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 15) return 1;
  if (BAN_TERMS.test(t)) return 1;
  const wordCount = t.split(/\s+/).length;
  const multiDim = (t.match(SPECIFICITY_HINTS) || []).length;
  if (wordCount >= 35 && multiDim >= 2) return 3;
  if (wordCount >= 20 || multiDim >= 1) return 2;
  return 1;
}

/**
 * @param {Object} input
 * @param {string} input.justification    free-text reasoning from the team
 * @param {string} input.mode             careers mode (best-fit / pathway-builder / ...)
 * @param {string} [input.scenarioSummary] short context the AI uses to judge fit
 * @returns {Promise<{ tier: 1|2|3, source: "heuristic" | "ai", reason?: string }>}
 */
export async function scoreJustification({ justification, mode, scenarioSummary = "" }) {
  const safe = String(justification || "").trim();
  if (!safe) return { tier: 1, source: "heuristic", reason: "empty" };

  // Heuristic-only path if no API key available
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { tier: _heuristicScore(safe), source: "heuristic" };

  // Profanity / identity-target check before sending to the model — caught text is auto-tier-1.
  if (BAN_TERMS.test(safe)) return { tier: 1, source: "heuristic", reason: "ban-term" };

  const prompt = `You score a STUDENT JUSTIFICATION on a CAREERS task. Mode: ${mode || "best-fit"}.
${scenarioSummary ? `\nScenario context: ${scenarioSummary}\n` : ""}
Student justification:
"""
${safe.slice(0, 800)}
"""

Tier rules (output a SINGLE integer 1, 2, or 3, nothing else):
- 1 = vague, single-word reasoning, or no real reasoning ("she's good", "I dunno")
- 2 = concrete but one-dimensional ("she's good at math, so she'd fit the role")
- 3 = multi-dimensional, names specific traits AND trade-offs, shows empathy or strategic thought

CRITICAL: penalize identity-targeted language. If the text relies on stereotypes
(gender / race / appearance / ability) instead of trait-based reasoning, output 1.

Output: just the integer.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CAREERS_SCORER_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 6,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    const j = await r.json();
    const text = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const num = parseInt(text, 10);
    if (num === 1 || num === 2 || num === 3) return { tier: num, source: "ai" };
    return { tier: _heuristicScore(safe), source: "heuristic", reason: `bad-ai-output:${text.slice(0, 20)}` };
  } catch (e) {
    return { tier: _heuristicScore(safe), source: "heuristic", reason: `api-error:${e?.message?.slice(0, 40)}` };
  }
}

export default { scoreJustification };
