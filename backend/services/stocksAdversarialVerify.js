// backend/services/stocksAdversarialVerify.js
//
// Adversarial verify pass — the AI-only edge that separates a generic LLM
// stock picker from a real research tool. After the main model builds a
// recommendation, a SECOND (skeptical short-seller) call attacks the
// thesis. The verdict adjusts the weighted score and gets attached to
// the pick so the UI can badge "bear-tested" vs "bear-case flagged" vs
// "rejected."
//
// Costs: one Haiku call per pick (fractions of a cent). Runs in parallel.

import { formatTechnicalsLine } from "./stocksTechnicals.js";
import { formatFundamentalsLine } from "./stocksFundamentals.js";

const MODEL = process.env.STOCKS_ADVERSARIAL_MODEL || "claude-haiku-4-5";

// Extract the first {...} JSON object out of Claude text — tolerant of code
// fences and preamble the model sometimes adds around the JSON payload.
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Attack ONE pick with a skeptical-short-seller persona. Returns
// {verdict, confidenceAdjustment, bearThesis, weakestPoint, hiddenRisk, reasoning}
// or null if the call fails or JSON can't be parsed (fail-open — the pick
// still ships but without a verify badge).
export async function verifyPick(pick, tech, fund) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !pick?.ticker) return null;

  const evidenceLines = [
    pick.bullCase ? `BULL CASE: ${pick.bullCase}` : null,
    pick.watchZone ? `ENTRY ZONE: ${pick.watchZone}` : null,
    pick.projection?.target != null ? `TARGET: $${pick.projection.target} (projected ROI ${pick.projection.projectedRoiPct}%)` : null,
    pick.projection?.stop != null ? `STOP: $${pick.projection.stop} (downside ${pick.projection.downsidePct}%)` : null,
    pick.whyBeatOthers ? `WHY IT BEATS OTHERS: ${pick.whyBeatOthers}` : null,
    Array.isArray(pick.keyCatalysts) && pick.keyCatalysts.length ? `KEY CATALYSTS: ${pick.keyCatalysts.join(" · ")}` : null,
    pick.whatProvesWrong ? `WHAT THE ORIGINAL AUTHOR SAID WOULD PROVE THEM WRONG: ${pick.whatProvesWrong}` : null,
  ].filter(Boolean).join("\n");

  const quantLines = [
    tech ? `TECHNICALS: ${formatTechnicalsLine(tech)}` : null,
    fund ? `FUNDAMENTALS: ${formatFundamentalsLine(fund)}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are an experienced short-seller with 20 years of blowing up long theses. Your entire job is to STRESS-TEST this recommendation and find why it will fail. Default to skepticism. If evidence isn't overwhelming, downgrade or reject.

TICKER: ${pick.ticker}${pick.name ? ` (${pick.name})` : ""}
CURRENT SCORE: ${pick.weightedScore ?? "?"}
RISK RATING: ${pick.riskRating || "?"}

${evidenceLines}

${quantLines}

Your task: attack this thesis. Do NOT hedge. Do NOT restate the bull case sympathetically. Find the ONE strongest reason this trade fails, the FLIMSIEST part of the bull argument, and any RISK the original author missed.

Return ONLY this JSON (no prose, no code fences):
{
  "bearThesis": "1-2 sentences — the strongest specific case AGAINST this trade (name numbers, competitors, macro factors, specific execution risk)",
  "weakestPoint": "1 sentence — the single flimsiest part of the current bull thesis (be brutal)",
  "hiddenRisk": "1 sentence — a specific risk the bull thesis DIDN'T address (or 'none material' if you truly can't find one)",
  "verdict": "confirmed_long" | "risk_flagged" | "reject",
  "confidenceAdjustment": <integer from -30 to +5>,
  "reasoning": "1-2 sentences on your final verdict"
}

VERDICT RULES:
- "confirmed_long": bear case is weak; you tried but couldn't destroy the thesis. Adjustment 0 to +5.
- "risk_flagged": bear case has real teeth; the trade may work but the risk is understated. Adjustment -5 to -15.
- "reject": the bear case is stronger than the bull case; DO NOT take this trade. Adjustment -20 to -30.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      console.warn(`[adversarial-verify] ${pick.ticker} → HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    const text = j?.content?.[0]?.text || "";
    const parsed = extractJson(text);
    if (!parsed || !["confirmed_long", "risk_flagged", "reject"].includes(parsed.verdict)) return null;
    // Clamp the adjustment to [-30, +5] regardless of what the model returned.
    const adj = Math.max(-30, Math.min(5, Number.isFinite(+parsed.confidenceAdjustment) ? +parsed.confidenceAdjustment : 0));
    return {
      verdict: parsed.verdict,
      confidenceAdjustment: adj,
      bearThesis: String(parsed.bearThesis || "").slice(0, 400),
      weakestPoint: String(parsed.weakestPoint || "").slice(0, 200),
      hiddenRisk: String(parsed.hiddenRisk || "").slice(0, 200),
      reasoning: String(parsed.reasoning || "").slice(0, 300),
      verifiedAt: new Date(),
    };
  } catch (e) {
    console.warn(`[adversarial-verify] ${pick.ticker} → ${e?.message || e}`);
    return null;
  }
}

// ─── Daily-pick adapter (Tier 3.1 audit Aug-28) ──────────────────
// Adapts a daily-pick shape (deterministicScore, targetPrice,
// stopPrice, setupName, rationale) into the discovery-pick shape
// verifyPick expects (bullCase, watchZone, projection, keyCatalysts).
// Then routes through the same Haiku bear-case attack.
//
// Called from renderDailyPicksDeterministic on picks with tier=BUY
// BEFORE the tier is finalized. Verdict "reject" downgrades tier to
// SCREENED-BEAR; "risk_flagged" is annotated but doesn't change tier
// (deterministic gates already have R/R + MTF + regime protection).
//
// Fail-open: if the Anthropic call fails or returns malformed JSON,
// this returns null and the pick ships as-is with no bear badge.
export async function verifyDailyPickAdversarial(dailyPick) {
  if (!dailyPick || !dailyPick.ticker) return null;
  // Build the discovery-pick shape verifyPick expects. Rationale
  // becomes the bull case; setupName + score becomes the "why". If
  // the daily pick has scoreContributors, they become the catalysts
  // list — makes the bear case attack the actual signals we scored on.
  const projection = {
    target: dailyPick.targetPrice ?? null,
    stop: dailyPick.stopPrice ?? null,
    projectedRoiPct: (dailyPick.targetPrice && dailyPick.entryPrice)
      ? Math.round(((dailyPick.targetPrice - dailyPick.entryPrice) / dailyPick.entryPrice) * 1000) / 10
      : null,
    downsidePct: (dailyPick.stopPrice && dailyPick.entryPrice)
      ? Math.round(((dailyPick.entryPrice - dailyPick.stopPrice) / dailyPick.entryPrice) * 1000) / 10
      : null,
  };
  const adapted = {
    ticker: dailyPick.ticker,
    weightedScore: dailyPick.compositeRank ?? dailyPick.deterministicScore,
    riskRating: dailyPick.deterministicScore >= 80 ? "medium" : dailyPick.deterministicScore >= 60 ? "elevated" : "high",
    bullCase: dailyPick.rationale || `Composite ${dailyPick.deterministicScore} · setup ${dailyPick.setupName || "n/a"}`,
    watchZone: dailyPick.entryPrice ? `$${dailyPick.entryPrice.toFixed(2)}` : null,
    projection,
    whyBeatOthers: dailyPick.multiFactorContributors?.slice(0, 5).join(" · ") || null,
    keyCatalysts: dailyPick.scoreContributors?.slice(0, 5) || null,
    whatProvesWrong: dailyPick.stopPrice ? `Break of stop $${dailyPick.stopPrice.toFixed(2)}` : null,
  };
  // Route through the same verifyPick — no tech/fund objects, so the
  // bear-case operates on the bull thesis alone (still surfaces real
  // teeth on macro / competitor / valuation risk).
  return verifyPick(adapted, null, null);
}

// Attack N daily picks in parallel with a concurrency cap. Similar
// shape to verifyPicksBatch but uses the daily-pick adapter.
export async function verifyDailyPicksBatch(dailyPicks, { concurrency = 3 } = {}) {
  if (!Array.isArray(dailyPicks) || dailyPicks.length === 0) return {};
  const out = {};
  for (let i = 0; i < dailyPicks.length; i += concurrency) {
    const slice = dailyPicks.slice(i, i + concurrency);
    await Promise.all(slice.map(async (pick) => {
      try {
        const v = await verifyDailyPickAdversarial(pick);
        if (v) out[pick.ticker] = v;
      } catch { /* fail-open */ }
    }));
  }
  return out;
}

// Attack N picks in parallel. Returns the same shape as verifyPick, indexed
// by ticker so the caller can attach to each pick without positional coupling.
export async function verifyPicksBatch(picks, quantByTicker) {
  if (!Array.isArray(picks) || picks.length === 0) return {};
  const results = await Promise.all(
    picks.map(async (pick) => {
      const q = quantByTicker?.[pick.ticker] || {};
      const v = await verifyPick(pick, q.tech, q.fund);
      return [pick.ticker, v];
    })
  );
  return Object.fromEntries(results.filter(([, v]) => v));
}
