// backend/services/stocksMosaic.js
//
// "Mosaic Intelligence" — mosaic-theory signal aggregation. Combines many
// weak but LEGAL, PUBLIC, commercially-available signals into a single
// "Mosaic Edge Score" (0-100) that estimates whether public data suggests
// something important may be happening before the market fully prices it.
//
// LEGAL POSTURE (hard rule, enforced in the prompt and surfaced to the user):
//   Public-data inference only. The model is instructed to REJECT and ignore
//   anything that appears non-public, leaked, hacked, confidential, or from
//   private employee tips / non-public earnings info. This is mosaic theory,
//   NOT insider information. Sources must be public/commercial (SEC EDGAR
//   Form 4, USPTO, public job boards, app-store rankings, lobbying disclosure
//   databases, court dockets, earnings-call transcripts, etc.).
//
// We have no dedicated alt-data APIs, so the signal gathering runs through the
// AI web_search layer under the guardrail above. The Mosaic Edge Score itself
// is blended IN CODE from the seven weighted category scores the AI returns,
// so the number stays transparent and reproducible.

export const MOSAIC_DISCLAIMER =
  "This module uses public-data inference only and does not provide or seek insider information.";

// Seven weighted categories. "Event pressure" (timing) is captured separately
// as context and is NOT part of the weighted Edge Score (matches the spec,
// whose weights cover seven categories summing to 100%).
export const MOSAIC_CATEGORIES = [
  ["insiderFilings", "Insider / public filings"],
  ["demand", "Customer demand"],
  ["hiring", "Hiring / workforce"],
  ["supplyChain", "Supply chain / vendor"],
  ["regulatory", "Regulatory / government"],
  ["marketStructure", "Market structure"],
  ["managementLanguage", "Management language"],
];

// Filter modes re-tilt the category weights and set rumour tolerance.
// "balanced" matches the spec exactly. Each preset sums to 1.0.
export const MOSAIC_MODES = {
  // Conservative: lean on hard filings + regulatory + market structure;
  // discount alt-data demand/hiring; reject rumours outright.
  conservative: {
    weights: { insiderFilings: 0.26, demand: 0.12, hiring: 0.10, supplyChain: 0.14, regulatory: 0.16, marketStructure: 0.14, managementLanguage: 0.08 },
    rumourTolerance: "reject", // ignore rumour-grade signals entirely
    rankWeight: 0.10,          // how much Mosaic tilts the high-conviction blend
  },
  balanced: {
    weights: { insiderFilings: 0.20, demand: 0.20, hiring: 0.15, supplyChain: 0.15, regulatory: 0.10, marketStructure: 0.10, managementLanguage: 0.10 },
    rumourTolerance: "flag",   // include but flag + de-weight
    rankWeight: 0.15,
  },
  // Aggressive alternative-data: lean on demand/hiring/supply alt-data.
  aggressive: {
    weights: { insiderFilings: 0.14, demand: 0.26, hiring: 0.20, supplyChain: 0.18, regulatory: 0.06, marketStructure: 0.08, managementLanguage: 0.08 },
    rumourTolerance: "flag",
    rankWeight: 0.25,
  },
};

export function mosaicMode(mode) {
  return MOSAIC_MODES[mode] || MOSAIC_MODES.balanced;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// ── Transparent Edge Score blend (in code) ─────────────────────────────
// Blend the seven category scores by the mode weights. Missing categories are
// dropped and weights renormalized. Then apply a rumour/social penalty so a
// score can't be propped up by hype-only signals.
export function blendMosaicEdge(categoryScores, weights, { rumourShare = 0, socialShare = 0 } = {}) {
  let wsum = 0, acc = 0;
  for (const [key] of MOSAIC_CATEGORIES) {
    const s = num(categoryScores[key]);
    if (s == null) continue;
    acc += clamp(s, 0, 100) * weights[key];
    wsum += weights[key];
  }
  if (wsum === 0) return null;
  let edge = acc / wsum;
  // Penalty: the more the evidence leans on rumours / social-only chatter,
  // the less the Edge Score is trustworthy. Up to −25.
  const penalty = Math.min(25, rumourShare * 30 + socialShare * 20);
  edge = edge - penalty;
  return clamp(Math.round(edge), 0, 100);
}

// ── AI batch assessment (public-data web_search, guardrailed) ──────────
// candidates: [{ ticker, name, sector, marketCap, price, currency,
//                fundamentalsHint }]  — fundamentalsHint lets the model apply
// the dilution / weak-cash / no-revenue penalties the spec requires.
export async function assessMosaicBatch(candidates, mode = "balanced") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for Mosaic Intelligence");
  const cfg = mosaicMode(mode);

  const rumourRule = cfg.rumourTolerance === "reject"
    ? "CONSERVATIVE MODE: ignore rumour-grade and social-media-only signals entirely — do not let them affect any category score."
    : "Include rumour-grade signals ONLY when corroborated by a second independent public source; otherwise mark them isRumour=true and they must NOT dominate any category score.";

  const list = candidates.map((c, i) =>
    `[#${i + 1}] ${c.ticker} — ${c.name || "?"} (${c.sector || "?"}), ~$${c.marketCap ? (c.marketCap / 1e9).toFixed(2) + "B" : "?"} cap, price ${c.price != null ? "$" + c.price + " " + (c.currency || "USD") : "?"}`
  ).join("\n");

  const prompt = `You are an analyst applying MOSAIC THEORY: combine many weak but LEGAL, PUBLIC signals into a stronger inference about hidden business momentum. Mode: "${mode}".

⚖️ HARD LEGAL RULE — non-negotiable:
- Use ONLY legal, public, or commercially-available data. Examples of allowed public sources: SEC EDGAR Form 4 / 13F, USPTO patent filings, public job boards (sudden posting changes), app-store rankings, public web-traffic/search-trend estimates, lobbying-disclosure databases, government procurement/contract-award databases, court dockets, regulatory calendars (FDA/Health Canada/SEC), published earnings-call transcripts, company/partner press releases.
- REJECT and IGNORE anything that appears non-public, leaked, hacked, confidential, from private employee tips, or non-public earnings information. If a signal can't be tied to a public source, drop it.
- This is mosaic inference, NOT insider information.

Penalties (apply to category scores):
- A thesis resting only on social-media hype → low scores; set isSocialOnly=true on those signals.
- ${rumourRule}
- If the company shows heavy share dilution, weak cash position, or no revenue support, cap demand/hiring/management scores and note it.

CANDIDATES:
${list}

For EACH candidate, use web_search across the public sources above and score these SEVEN categories 0-100 (evidence strength, not certainty):
1. insiderFilings — Form 4 buying/selling, cluster insider buying by multiple execs, buys after price drops, comp changes, director resignations, CFO changes, relevant new board members.
2. demand — app-download rankings, web-traffic changes, product-review volume/sentiment, store-traffic estimates, search trends, social engagement (penalize if social-only), waitlists/backorders.
3. hiring — sudden job-posting changes, hiring in sales/AI/manufacturing/logistics/regulatory/international, layoffs vs selective strategic hiring, public employee-review trends, legal headcount signals.
4. supplyChain — supplier announcements, legally-available shipping/import-export data, inventory shortages, distributor comments, manufacturing expansion, capex, partner-company mentions.
5. regulatory — contract awards, lobbying activity, patent filings, FDA/Health Canada/SEC calendars, court cases, grants, infrastructure approvals, procurement databases.
6. marketStructure — short-interest changes, days-to-cover, borrow-fee spikes, unusual options volume, put/call shifts, legally-available dark-pool volume, 13F accumulation, ETF inclusion/removal risk.
7. managementLanguage — compare earnings-call transcripts over time: tone/confidence/specificity/urgency shifts; repeated words like "inflection", "accelerating", "record backlog", "capacity constrained", "pricing power", "strategic alternatives"; guidance wording QoQ; more-specific timelines.

ALSO capture (timing context, NOT scored): eventPressure — upcoming earnings, product-launch windows, investor/analyst days, conference presentations, lockup expirations, debt maturities, legal deadlines, merger-approval dates.

Return STRICT JSON only:
{
  "results": [
    {
      "ticker": "ABCD",
      "categoryScores": { "insiderFilings": <0-100>, "demand": <0-100>, "hiring": <0-100>, "supplyChain": <0-100>, "regulatory": <0-100>, "marketStructure": <0-100>, "managementLanguage": <0-100> },
      "topSignals": [
        { "signal": "what the public data shows", "category": "<one of the 7 keys>", "sourceCategory": "e.g. SEC EDGAR Form 4 / USPTO / public job board / app-store ranking / lobbying database", "direction": "confirming" | "contradictory" | "neutral", "confidence": "low" | "medium" | "high", "falseSignalRisk": "low" | "medium" | "high", "pricedIn": "no" | "partly" | "yes", "isRumour": true | false, "isSocialOnly": true | false }
      ],
      "overallConfirmation": "confirming" | "mixed" | "contradictory",
      "confidence": <0-100>,
      "alreadyPricedIn": "no" | "partly" | "yes",
      "followUp": "1-2 specific public-data follow-ups to confirm the thesis",
      "penaltiesApplied": ["dilution" | "weak-cash" | "no-revenue" | "social-only" | "rumour-heavy", ...],
      "eventPressure": ["upcoming earnings 2025-..", "lockup expiry 2025-.."],
      "legalityNote": "1 sentence: why this is public-data inference, not insider information (name the public source types used)",
      "sources": [{ "title": "...", "url": "..." }]
    }
  ]
}
Provide top 5 strongest signals per candidate (most decision-relevant first). No prose outside the JSON.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-6",
      max_tokens: 5000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, parseInt(process.env.STOCKS_MOSAIC_MAX_SEARCHES, 10) || 12) }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${err.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { results: [] };
  try { return JSON.parse(m[0]); } catch { return { results: [] }; }
}

// Turn one AI result into a persisted/displayable mosaic object with the
// transparent Edge Score computed in code.
export function buildMosaicForResult(aiResult, mode) {
  const cfg = mosaicMode(mode);
  const cats = aiResult?.categoryScores || {};
  const topSignals = Array.isArray(aiResult?.topSignals) ? aiResult.topSignals.slice(0, 5) : [];

  // Rumour / social share among the surfaced signals (drives the penalty).
  const total = topSignals.length || 1;
  let rumourCount = 0, socialCount = 0;
  const cleanSignals = [];
  for (const s of topSignals) {
    const isRumour = !!s.isRumour;
    const isSocialOnly = !!s.isSocialOnly;
    // Conservative mode rejects rumour/social-only signals from display + score.
    if (cfg.rumourTolerance === "reject" && (isRumour || isSocialOnly)) continue;
    if (isRumour) rumourCount++;
    if (isSocialOnly) socialCount++;
    cleanSignals.push({
      signal: String(s.signal || "").slice(0, 300),
      category: String(s.category || ""),
      sourceCategory: String(s.sourceCategory || "").slice(0, 80),
      direction: ["confirming", "contradictory", "neutral"].includes(s.direction) ? s.direction : "neutral",
      confidence: ["low", "medium", "high"].includes(s.confidence) ? s.confidence : "medium",
      falseSignalRisk: ["low", "medium", "high"].includes(s.falseSignalRisk) ? s.falseSignalRisk : "medium",
      pricedIn: ["no", "partly", "yes"].includes(s.pricedIn) ? s.pricedIn : "partly",
      isRumour, isSocialOnly,
    });
  }
  const rumourShare = rumourCount / total;
  const socialShare = socialCount / total;

  const categoryScores = {};
  const categories = [];
  for (const [key, label] of MOSAIC_CATEGORIES) {
    const score = num(cats[key]);
    categoryScores[key] = score;
    categories.push({ key, label, score, weight: cfg.weights[key] });
  }

  const edgeScore = blendMosaicEdge(categoryScores, cfg.weights, { rumourShare, socialShare });

  return {
    mode,
    edgeScore,
    confidence: clamp(num(aiResult?.confidence) ?? 50, 5, 95),
    categories,
    topSignals: cleanSignals,
    overallConfirmation: ["confirming", "mixed", "contradictory"].includes(aiResult?.overallConfirmation) ? aiResult.overallConfirmation : "mixed",
    alreadyPricedIn: ["no", "partly", "yes"].includes(aiResult?.alreadyPricedIn) ? aiResult.alreadyPricedIn : "partly",
    followUp: String(aiResult?.followUp || "").slice(0, 600),
    penaltiesApplied: Array.isArray(aiResult?.penaltiesApplied) ? aiResult.penaltiesApplied.slice(0, 6) : [],
    eventPressure: Array.isArray(aiResult?.eventPressure) ? aiResult.eventPressure.slice(0, 8) : [],
    rumourFlagged: rumourCount > 0 || socialCount > 0,
    legalityNote: String(aiResult?.legalityNote || "All signals derived from public sources (SEC filings, public job boards, regulatory calendars, transcripts) — mosaic inference, not insider information.").slice(0, 400),
    disclaimer: MOSAIC_DISCLAIMER,
    sources: (Array.isArray(aiResult?.sources) ? aiResult.sources : []).filter((s) => s && s.url).slice(0, 8).map((s) => ({ title: s.title || s.url, url: s.url })),
  };
}

// Score a whole batch and return { [ticker]: mosaicObject }.
export async function runMosaicBatch(candidates, mode = "balanced") {
  const ai = await assessMosaicBatch(candidates, mode);
  const out = {};
  for (const res of (ai.results || [])) {
    const ticker = String(res.ticker || "").toUpperCase();
    if (!ticker) continue;
    out[ticker] = buildMosaicForResult(res, mode);
  }
  return out;
}
