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
export async function assessMoonshot(candidates, market = "both", horizon = "long") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for Moonshot mode");
  const isShort = horizon === "short";

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

  const shortTermAddendum = `
SHORT-TERM MODE — HORIZON IS 3–18 MONTHS, NOT YEARS. A 10x in this window is almost never fundamental compounding; it is one of: (1) multiple re-rating, (2) narrative ignition, (3) supply/demand squeeze, (4) hard catalyst inflection (FDA, big contract, beat-and-raise, profitability crossover, takeout), (5) sector momentum + being the clean leader.

DETECT AND REPORT EXPLICITLY for each candidate (use web_search):
A. CATALYST CALENDAR — list every BINARY event in the next 90 days WITH DATES (earnings, FDA/PDUFA, trial readout, contract decision, launch, index-inclusion candidacy). A short-term candidate with NO catalyst in 6 months is auto-rejected. Score "catalystDensity" 0-100 = number × magnitude of plausibly-bullish binary events in 6 months.
B. SUPPLY/DEMAND MECHANICS — float size, short interest %, days-to-cover, options OI concentration. Score "supplyDemand" 0-100. Flag SUPPLY KILLERS with dates: lockup expirations, active ATM/shelf draws, insider 10b5-1 sales, convertible overhang. Any supply killer inside the horizon → downgrade hard.
C. NARRATIVE IGNITION STAGE — detect PRE-virality: X mentions accelerating WoW but low absolute, early WSB DD, 1-3 mid-tier YouTube creators, rising Stocktwits, positive Google-Trends slope at low level. Classify stage: "Early" | "Mid" | "Late" | "Peak". REJECT names already at peak retail crowding (the move already happened). Score "narrativeIgnition" 0-100 (highest for Early).
D. INFLECTION POINTS — first GAAP-profit quarter, margin crossing 40/50/60%, FCF turning positive, operating-leverage step-change, net-cash established.
E. OPTIONS READ — unusual call volume (>3x 20d avg), sustained C/P > 2.5, cheap front-month IV vs back, dealer short-gamma, large OTM sweeps. Summarize in "optionsRead".
F. PRECEDENT MATCHING — name 2-3 historical comparables that ran 10x in a similar setup and what stage this is vs theirs (e.g. "like NVDA Apr-2023", "like SMCI mid-2023"). If you can't name a credible precedent, the thesis is weak.
G. CROWDING — estimate how discovered it already is (analyst count, 13F holders, WSB rank, CNBC/Bloomberg frequency, insider sell volume). Score "crowdingInverse" 0-100 where HIGHER = LESS crowded (better entry). Reject top-5% crowding.
H. SECTOR MOMENTUM — short-term 10x needs a sector tailwind. Confirm sector ETF rising + broad leadership. Score "sectorMomentum" 0-100. A 10x in a falling sector is improbable.
I. STOP DISCIPLINE — give invalidation price, recommended max position size (% of portfolio), trailing-stop strategy, and a time-based stop (exit N days after catalyst if no move).

HARD REJECTS (set hardReject=true + reason): no catalyst within 6 months; lockup/large ATM inside horizon; >90th-pct retail crowding; sector in confirmed downtrend; avg daily $ volume < $5M; float-rotation already >2x in last 30 days (move likely cooked).`;

  const calibration = isShort
    ? `PROBABILITY CALIBRATION (do not produce fiction): A short-term (≤18mo) 10x is EXTREMELY rare — even a perfect catalyst+squeeze+narrative setup is low-single-digits for 10x and maybe low-double-digits for 5x. Hard ceilings: P(5x) ≤ 30%, P(10x) ≤ 15%, P(10x) < P(5x) always. Rough PRIORS, not forecasts.`
    : `PROBABILITY CALIBRATION (do not produce fiction): 10x over 5–10y is RARE. Base rate for a random small-cap is ~1–3%; even an exceptional, convergent setup is at most low-double-digits. Hard ceilings: P(5x) ≤ 30%, P(10x) ≤ 15%, P(10x) < P(5x) always. Rough PRIORS, not forecasts.`;

  const shortSchemaFields = isShort ? `,
      "subScores": { "catalystDensity": <0-100>, "supplyDemand": <0-100>, "narrativeIgnition": <0-100>, "crowdingInverse": <0-100>, "sectorMomentum": <0-100> },
      "catalystCalendar": ["2025-XX-XX earnings", "2025-XX-XX PDUFA", "..."],
      "floatShort": "float size, short interest %, days-to-cover",
      "supplyKillers": ["lockup 2025-XX-XX ~Xm shares", "ATM active", "..."],
      "narrativeStage": "Early" | "Mid" | "Late" | "Peak",
      "optionsRead": "unusual flow / IV skew / dealer gamma summary",
      "precedents": ["like NVDA Apr-2023 (stage: ...)", "..."],
      "sectorMomentumNote": "Y/N + sector ETF return",
      "invalidationPrice": <number>,
      "maxPositionPct": <number, e.g. 3>,
      "stopStrategy": "trailing + time-based stop",
      "hardReject": false,
      "hardRejectReason": ""` : "";

  const prompt = `You are an elite asymmetric-opportunity analyst. From the pre-screened candidates below, select the 2–5 with the most credible REALISTIC 5x–10x potential over a ${isShort ? "3–18 MONTH" : "3–10 YEAR"} horizon — ${isShort ? "driven by catalysts, supply/demand mechanics, and early-stage narrative ignition, NOT slow fundamental compounding" : "the profile of an emerging category leader BEFORE the market fully prices it in"}. This is NOT a safety screen.

Candidates (deterministic + public-data signals already computed):
${lines}
${isShort ? shortTermAddendum : `
Use web_search to evaluate each on: massive/expanding TAM, accelerating revenue, narrative shift underway, institutional accumulation (public 13F/Form 4), founder-led/visionary leadership, balance-sheet durability or strategic capital access, operating leverage, multi-year macro tailwinds (AI infra, defense, energy/nuclear, semis, cybersecurity, fintech, robotics, space, reshoring), and signal CONVERGENCE across lenses.`}

Reject/penalize: pump-and-dumps, fraud-risk microcaps, pure meme/hype with no execution, heavily-diluted zombies, no real business, obvious value traps. Penalize hype-without-execution and dilution hard.

${calibration}

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
      "sources": [{"title":"...","url":"..."}]${shortSchemaFields}
    }
  ]
}
If fewer than 2 candidates clear a genuine asymmetric bar${isShort ? " (or all have hardReject=true)" : ""}, return fewer. Do not pad. No prose outside the JSON.`;

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
export function buildMoonshotResult(aiItem, candidate, horizon = "long") {
  const ms = candidate.moonshot || {};
  const isShort = horizon === "short";
  const ss = aiItem.subScores || {};
  const { p5xPct, p10xPct } = calibrateProbabilities(aiItem.p5xPct, aiItem.p10xPct);

  // Transparent composite (0-100). Long-term weights reward durable compounding
  // signals; short-term reweights toward catalysts / supply-demand / narrative
  // ignition / technical / sector momentum / low crowding (per the addendum).
  const techBlend = (() => {
    const a = candidate.sub?.technical?.score, b = ms.preParabolic?.score;
    const vals = [a, b].filter(Number.isFinite);
    return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  })();
  const parts = isShort
    ? [
        [candidate.sub?.fundamentals?.score, 0.12],
        [candidate.sub?.riskControl?.score, 0.05],
        [techBlend, 0.15],
        [num(ss.catalystDensity), 0.20],
        [num(ss.supplyDemand), 0.13],
        [num(ss.narrativeIgnition), 0.13],
        [num(ss.crowdingInverse), 0.09],
        [num(ss.sectorMomentum), 0.08],
        [ms.realityLag?.score, 0.05],
      ]
    : [
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

  const shortTerm = isShort ? {
    catalystDensity: num(ss.catalystDensity),
    supplyDemand: num(ss.supplyDemand),
    narrativeIgnition: num(ss.narrativeIgnition),
    crowdingInverse: num(ss.crowdingInverse),
    sectorMomentum: num(ss.sectorMomentum),
    catalystCalendar: arr(aiItem.catalystCalendar),
    floatShort: str(aiItem.floatShort, 200),
    supplyKillers: arr(aiItem.supplyKillers),
    narrativeStage: ["Early", "Mid", "Late", "Peak"].includes(aiItem.narrativeStage) ? aiItem.narrativeStage : null,
    optionsRead: str(aiItem.optionsRead, 400),
    precedents: arr(aiItem.precedents),
    sectorMomentumNote: str(aiItem.sectorMomentumNote, 200),
    invalidationPrice: num(aiItem.invalidationPrice),
    maxPositionPct: num(aiItem.maxPositionPct),
    stopStrategy: str(aiItem.stopStrategy, 300),
  } : null;

  return {
    horizon: isShort ? "short" : "long",
    compositeScore,
    p5xPct, p10xPct,
    hardReject: !!aiItem.hardReject,
    hardRejectReason: str(aiItem.hardRejectReason, 200),
    confidence: ["low", "medium", "high"].includes(aiItem.confidence) ? aiItem.confidence : "medium",
    timeHorizon: ["short-term", "medium-term", "long-term"].includes(aiItem.timeHorizon) ? aiItem.timeHorizon : (isShort ? "short-term" : "long-term"),
    shortTerm,
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
