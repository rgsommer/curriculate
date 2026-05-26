// backend/services/stocksMoonshot.js
//
// "Moonshot 10x" mode — hunts a tiny set (2–5) of asymmetric, high-upside
// candidates that *resemble* pre-exponential winners, combining the engine's
// deterministic factors + Mosaic public-data signals + a focused AI layer for
// the asymmetric-upside model, narrative/dominance thesis, and the expanded
// output. It is explicitly NOT a safety screen.
//
// HONESTY POSTURE (enforced in code + prompt): 10x over 5–10y is a very low
// base-rate, survivorship-biased outcome. We surface P(5x)/P(10x) only as
// rough, base-rate-anchored PRIORS — calibrated and hard-capped here so the AI
// can't emit confident fiction — and label everything as speculative. The
// discovery scorecard measures whether the mode actually finds winners.

export const MOONSHOT_DISCLAIMER =
  "Moonshot mode hunts asymmetric 5–10x setups. These are speculative, high-risk, low-base-rate bets — most will NOT 5x, let alone 10x. The probabilities are rough base-rate-anchored priors, not forecasts. This is not financial advice.";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Synthetic Insider Score: a composite of the Mosaic categories that proxy
// "smart-money / insider-adjacent" behavior. Public-data only.
export function syntheticInsiderScore(mosaic) {
  if (!mosaic || !Array.isArray(mosaic.categories)) return null;
  const byKey = {};
  for (const c of mosaic.categories) byKey[c.key] = num(c.score);
  const parts = [[byKey.insiderFilings, 0.4], [byKey.marketStructure, 0.35], [byKey.managementLanguage, 0.25]];
  let acc = 0, w = 0;
  for (const [s, wt] of parts) { if (Number.isFinite(s)) { acc += s * wt; w += wt; } }
  return w > 0 ? Math.round(acc / w) : null;
}

// Calibrate + hard-cap the AI's 5x/10x probabilities to realistic base rates.
// Even a textbook setup is single-digit to low-double-digit % over 5–10y.
export function calibrateProbabilities(p5Raw, p10Raw) {
  let p5 = num(p5Raw);
  let p10 = num(p10Raw);
  if (p5 == null) p5 = null; else p5 = clamp(Math.round(p5), 1, 30); // cap P(5x) at 30%
  if (p10 == null) p10 = null; else p10 = clamp(Math.round(p10), 0, 15); // cap P(10x) at 15%
  // P(10x) can never exceed P(5x).
  if (p5 != null && p10 != null && p10 > p5) p10 = Math.round(p5 * 0.5);
  return { p5xPct: p5, p10xPct: p10 };
}

// One AI/web_search call over the shortlist: asymmetric-upside model, narrative
// & dominance thesis, the 20-field output, and selection of the top 2–5.
// Receives the deterministic + Mosaic signals so it reasons from evidence.
export async function assessMoonshot(candidates, market = "both") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for Moonshot mode");

  const lines = candidates.map((c, i) => {
    const s = c.sub || {};
    const ms = c.moonshot || {};
    const mq = c.raw?.fundamentals || {};
    const mosaicEdge = c.mosaic?.edgeScore;
    return `[#${i + 1}] ${c.ticker} — ${c.name || "?"} (${c.sector || "?"}), ~$${c.marketCap ? (c.marketCap / 1e9).toFixed(2) + "B" : "?"} cap, $${c.price ?? "?"} ${c.currency}
   deterministic: fundamentals=${s.fundamentals?.score ?? "n/a"}, momentum=${s.momentum?.score ?? "n/a"}, technical=${s.technical?.score ?? "n/a"}, risk=${s.riskControl?.score ?? "n/a"}
   moonshot signals: pre-parabolic=${ms.preParabolic?.score ?? "n/a"}, reality-lag=${ms.realityLag?.score ?? "n/a"}, synthetic-insider=${c.syntheticInsider ?? "n/a"}, mosaic-edge=${mosaicEdge ?? "n/a"}
   rev growth ${mq.revenueGrowthPct?.toFixed?.(0) ?? "?"}%, gross margin ${mq.grossMarginPct?.toFixed?.(0) ?? "?"}%, FCF yield ${mq.freeCashFlowYieldPct?.toFixed?.(1) ?? "?"}%, D/E ${mq.netDebtToEquity?.toFixed?.(2) ?? "?"}
   12/6/3mo return ${c.raw?.returns?.r12m?.toFixed?.(0) ?? "?"}/${c.raw?.returns?.r6m?.toFixed?.(0) ?? "?"}/${c.raw?.returns?.r3m?.toFixed?.(0) ?? "?"}%`;
  }).join("\n\n");

  const prompt = `You are an elite asymmetric-opportunity analyst. From the pre-screened candidates below, select the 2–5 with the most credible REALISTIC 5x–10x potential over a 3–10 year horizon — the profile of an emerging category leader BEFORE the market fully prices it in. This is NOT a safety screen.

Candidates (deterministic + public-data signals already computed):
${lines}

Use web_search to evaluate each on: massive/expanding TAM, accelerating revenue, narrative shift underway, institutional accumulation (public 13F/Form 4), founder-led/visionary leadership, balance-sheet durability or strategic capital access, operating leverage, multi-year macro tailwinds (AI infra, defense, energy/nuclear, semis, cybersecurity, fintech, robotics, space, reshoring), and signal CONVERGENCE across lenses.

Reject/penalize: pump-and-dumps, fraud-risk microcaps, pure meme/hype with no execution, heavily-diluted zombies, no real business, obvious value traps. Penalize hype-without-execution and dilution hard.

PROBABILITY CALIBRATION (critical — do not produce fiction):
- 10x over 5–10y is RARE. Base rate for a random small-cap is ~1–3%. Even an exceptional, convergent setup is at most low-double-digits.
- Anchor to those base rates. Hard ceilings: P(5x) ≤ 30%, P(10x) ≤ 15%, and P(10x) < P(5x) always. If you're tempted to go higher, you're wrong.
- These are rough PRIORS, not forecasts. Favor asymmetry (downside ~50–70% vs upside 500%+), not certainty.

LANGUAGE: never "guaranteed", "sure thing", "can't lose". Use "asymmetric", "probability-weighted", "highest-conviction", "watchlist candidate".

Return STRICT JSON only — the 2–5 strongest, best first:
{
  "picks": [
    {
      "ticker": "ABCD",
      "marketUnderestimation": "why the market may be underestimating it",
      "keyCatalysts": ["..."],
      "coreRisks": ["..."],
      "institutionalSignals": "what public institutional/insider signals were detected",
      "narrativeShift": "the narrative shift underway",
      "technicalSummary": "setup in one or two lines",
      "revenueMarginTrajectory": "rev + margin trend",
      "tamThesis": "TAM expansion thesis",
      "futureDominance": "could it become a platform/infrastructure/standard-setter/network — and why",
      "bestCase": "best-case scenario",
      "bearCase": "bear-case scenario",
      "estimatedUpside": "realistic upside range, e.g. '4x–8x if thesis plays out'",
      "p5xPct": <0-30 integer>,
      "p10xPct": <0-15 integer>,
      "confidence": "low" | "medium" | "high",
      "timeHorizon": "short-term" | "medium-term" | "long-term",
      "redFlags": ["..."],
      "finalThesis": "2-4 sentence investment thesis",
      "sources": [{"title":"...","url":"..."}]
    }
  ]
}
If fewer than 2 candidates clear a genuine asymmetric-10x bar, return fewer. Do not pad. No prose outside the JSON.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.STOCKS_DISCOVERY_MODEL || "claude-sonnet-4-6",
      max_tokens: 6000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, parseInt(process.env.STOCKS_MOONSHOT_MAX_SEARCHES, 10) || 12) }],
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
  if (!m) return { picks: [] };
  try { return JSON.parse(m[0]); } catch { return { picks: [] }; }
}

const arr = (v, n = 8) => (Array.isArray(v) ? v.filter((x) => x != null).slice(0, n) : []);
const str = (v, n = 1200) => (typeof v === "string" ? v.slice(0, n) : "");

// Assemble one AI pick + the candidate's deterministic/mosaic signals into the
// persisted/displayable moonshot object, with calibrated probabilities and a
// transparent composite score.
export function buildMoonshotResult(aiItem, candidate) {
  const ms = candidate.moonshot || {};
  const { p5xPct, p10xPct } = calibrateProbabilities(aiItem.p5xPct, aiItem.p10xPct);

  // Transparent composite (0-100): the asymmetry signals that define moonshot.
  const parts = [
    [candidate.sub?.fundamentals?.score, 0.18],
    [candidate.sub?.momentum?.score, 0.12],
    [ms.preParabolic?.score, 0.18],
    [ms.realityLag?.score, 0.14],
    [candidate.syntheticInsider, 0.16],
    [candidate.mosaic?.edgeScore, 0.12],
    [candidate.sub?.riskControl?.score, 0.10],
  ];
  let acc = 0, w = 0;
  for (const [s, wt] of parts) { if (Number.isFinite(s)) { acc += s * wt; w += wt; } }
  const compositeScore = w > 0 ? Math.round(acc / w) : null;

  return {
    compositeScore,
    p5xPct, p10xPct,
    confidence: ["low", "medium", "high"].includes(aiItem.confidence) ? aiItem.confidence : "medium",
    timeHorizon: ["short-term", "medium-term", "long-term"].includes(aiItem.timeHorizon) ? aiItem.timeHorizon : "long-term",
    signals: {
      preParabolic: ms.preParabolic?.score ?? null,
      preParabolicWhy: arr(ms.preParabolic?.contributors, 5),
      realityLag: ms.realityLag?.score ?? null,
      realityLagWhy: arr(ms.realityLag?.contributors, 3),
      syntheticInsider: candidate.syntheticInsider ?? null,
      mosaicEdge: candidate.mosaic?.edgeScore ?? null,
    },
    marketUnderestimation: str(aiItem.marketUnderestimation),
    keyCatalysts: arr(aiItem.keyCatalysts),
    coreRisks: arr(aiItem.coreRisks),
    institutionalSignals: str(aiItem.institutionalSignals, 600),
    narrativeShift: str(aiItem.narrativeShift, 600),
    technicalSummary: str(aiItem.technicalSummary, 400),
    revenueMarginTrajectory: str(aiItem.revenueMarginTrajectory, 400),
    tamThesis: str(aiItem.tamThesis, 600),
    futureDominance: str(aiItem.futureDominance, 600),
    bestCase: str(aiItem.bestCase, 600),
    bearCase: str(aiItem.bearCase, 600),
    estimatedUpside: str(aiItem.estimatedUpside, 200),
    redFlags: arr(aiItem.redFlags),
    finalThesis: str(aiItem.finalThesis, 900),
    sources: arr(aiItem.sources).filter((s) => s && s.url).map((s) => ({ title: s.title || s.url, url: s.url })),
    disclaimer: MOONSHOT_DISCLAIMER,
  };
}
