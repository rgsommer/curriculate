// backend/services/stocksScoringModels.js
//
// P2  (2026-09-08) — initial declaration of six scoring models (A-F).
// P2.5 (2026-09-09) — rebuilt Models C, E, F so their OQ weights emphasize
//                     the REAL signals the P2.5 patch wires:
//                       • realEpsRevisions       (was: price-target proxy)
//                       • postEarningsDrift      (was: not implemented)
//                       • catalystQuality        (was: not implemented)
//                       • industryStrength       (was: sector-fallback silent)
//                     Also added `criticalFactors` per model: factors
//                     WITHOUT which the model MUST NOT report a
//                     high-confidence score. When a critical factor is
//                     missing the scorer returns { status: "INSUFFICIENT_DATA" }
//                     for that model — no weight-redistribution masking.
//
// Model A remains the CHAMPION / LEGACY control; challenger models
// (B-F) all give opportunity ≥ entry.

export const OQ_FACTORS = [
  "fundamentals",        // FMP TTM ratios (FCF yield, ROE, D/E)
  "growth",              // FMP quarterly income (revenue/EPS accel)
  "revisions",           // P2.5 real EPS/rev estimate revisions (NOT price-target)
  "priceTargetContext",  // kept as SECONDARY context; never dominant
  "relativeStrength",    // 1m/3m/6m vs benchmark
  "insider",             // cluster buys / cluster velocity
  "industryStrength",    // peer-based 3m RS (or sector-fallback with lower cred)
  "postEarningsDrift",   // P2.5 surprise + gap-holds evaluation
  "catalystQuality",     // P2.5 structured catalyst score (only material catalysts count)
];

export const EQ_FACTORS = ["trend", "setup", "mtf", "rsi", "rvol", "extension"];

export const SCORING_MODELS = {
  // ─── A — CURRENT / CHAMPION (P4 control) ───────────────────
  A: {
    id: "A", label: "Current / champion",
    opportunityWeights: {
      fundamentals: 0.30, growth: 0.30, revisions: 0.20,
      relativeStrength: 0.15, insider: 0.05, industryStrength: 0.00,
      priceTargetContext: 0.00, postEarningsDrift: 0.00, catalystQuality: 0.00,
    },
    entryWeights: {
      trend: 0.35, setup: 0.30, mtf: 0.15, rsi: 0.10, rvol: 0.10, extension: 0.00,
    },
    combineWeights: { opportunity: 0.40, entry: 0.60 },
    criticalFactors: [],   // A is the LEGACY control — no critical gate
    description: "LEGACY entry-heavy control. Preserved for P4 shadow comparison. NEVER updated to new signals; that's why the challengers exist.",
  },

  // ─── B — QUALITY + MOMENTUM ────────────────────────────────
  B: {
    id: "B", label: "Quality + momentum",
    opportunityWeights: {
      fundamentals: 0.35, growth: 0.20, revisions: 0.10,
      relativeStrength: 0.20, insider: 0.05, industryStrength: 0.10,
      priceTargetContext: 0.00, postEarningsDrift: 0.00, catalystQuality: 0.00,
    },
    entryWeights: {
      trend: 0.45, setup: 0.15, mtf: 0.15, rsi: 0.10, rvol: 0.10, extension: 0.05,
    },
    combineWeights: { opportunity: 0.65, entry: 0.35 },
    criticalFactors: ["fundamentals"],
    description: "Underlying quality with a trend requirement. Fundamentals are critical — without FCF/ROE/D-E data B returns INSUFFICIENT_DATA.",
  },

  // ─── C — REVISIONS + MOMENTUM (P2.5 rebuilt) ───────────────
  // Was leaning on the price-target proxy. Now anchored in REAL EPS
  // revisions. Missing real revisions ⇒ INSUFFICIENT_DATA (must not
  // silently redistribute weight to fundamentals + RS).
  C: {
    id: "C", label: "Revisions + momentum (real EPS revisions)",
    opportunityWeights: {
      fundamentals: 0.10, growth: 0.15, revisions: 0.40,
      relativeStrength: 0.15, insider: 0.05, industryStrength: 0.10,
      priceTargetContext: 0.05, postEarningsDrift: 0.00, catalystQuality: 0.00,
    },
    entryWeights: {
      trend: 0.40, setup: 0.20, mtf: 0.20, rsi: 0.10, rvol: 0.10, extension: 0.00,
    },
    combineWeights: { opportunity: 0.60, entry: 0.40 },
    criticalFactors: ["revisions"],
    description: "Real EPS/revenue revision-driven. Requires a real revision baseline (not price-target proxy). Missing → INSUFFICIENT_DATA.",
  },

  // ─── D — QUALITY + GROWTH + REVISIONS + MOMENTUM ───────────
  // P4 audit (2026-09-11): Model D was labeled "GARP" but the OQ
  // factor bundle has NO explicit valuation factor (no forward
  // P/E-vs-growth, PEG, EV/EBITDA/growth, or FCF-yield-vs-growth
  // measure). Renamed to reflect what it actually tests — do not
  // claim GARP without a valuation factor to anchor the "R" in the
  // acronym. If a defensible PIT valuation factor is added later,
  // that creates a NEW model version (P4 spec §3, §16).
  D: {
    id: "D", label: "Quality + growth + revisions + momentum (NO explicit valuation factor)",
    opportunityWeights: {
      fundamentals: 0.25, growth: 0.25, revisions: 0.20,
      relativeStrength: 0.15, insider: 0.05, industryStrength: 0.10,
      priceTargetContext: 0.00, postEarningsDrift: 0.00, catalystQuality: 0.00,
    },
    entryWeights: {
      trend: 0.35, setup: 0.25, mtf: 0.15, rsi: 0.10, rvol: 0.10, extension: 0.05,
    },
    combineWeights: { opportunity: 0.60, entry: 0.40 },
    criticalFactors: ["fundamentals", "growth"],
    description: "Quality + growth + revisions + momentum. Fundamentals AND growth both critical. NOT true GARP — no explicit valuation-vs-growth factor. Rename honest per P4 spec §3.",
  },

  // ─── E — POST-EARNINGS DRIFT / CATALYST (P2.5 rebuilt) ─────
  // Was aspirational (weights only). Now genuine: requires either a
  // real post-earnings-drift row OR a material catalyst. Without
  // either, Model E returns INSUFFICIENT_DATA — it cannot claim
  // high-confidence post-earnings status.
  E: {
    id: "E", label: "Post-earnings drift / catalyst (real signals)",
    opportunityWeights: {
      fundamentals: 0.10, growth: 0.15, revisions: 0.20,
      relativeStrength: 0.05, insider: 0.05, industryStrength: 0.15,
      priceTargetContext: 0.00, postEarningsDrift: 0.20, catalystQuality: 0.10,
    },
    entryWeights: {
      trend: 0.20, setup: 0.20, mtf: 0.15, rsi: 0.05, rvol: 0.25, extension: 0.15,
    },
    combineWeights: { opportunity: 0.55, entry: 0.45 },
    // At least ONE of these is required — the coverage gate treats
    // this as "any-one satisfies critical." Encoded via a special
    // pseudo-factor key.
    criticalFactors: ["postEarningsDrift|catalystQuality"],
    description: "Post-earnings drift + material catalyst. Requires REAL earnings-surprise/drift OR a material catalyst row — otherwise INSUFFICIENT_DATA.",
  },

  // ─── F — RELATIVE-STRENGTH LEADERS (P2.5 rebuilt) ──────────
  // Wants: strong company + strong stock + strong INDUSTRY +
  // improving expectations. Industry strength is critical here —
  // sector-fallback source still runs but with a REDUCED confidence
  // stamp (see stocksOpportunityScore.js coverage math).
  F: {
    id: "F", label: "Relative-strength leaders (strong stock in strong industry)",
    opportunityWeights: {
      fundamentals: 0.15, growth: 0.15, revisions: 0.15,
      relativeStrength: 0.25, insider: 0.05, industryStrength: 0.25,
      priceTargetContext: 0.00, postEarningsDrift: 0.00, catalystQuality: 0.00,
    },
    entryWeights: {
      trend: 0.40, setup: 0.20, mtf: 0.20, rsi: 0.05, rvol: 0.10, extension: 0.05,
    },
    combineWeights: { opportunity: 0.60, entry: 0.40 },
    criticalFactors: ["industryStrength", "relativeStrength"],
    description: "Strong-company + strong-stock + strong-INDUSTRY (peer-verified) + improving expectations. Uses sector-fallback with lower confidence when peer data unavailable.",
  },
};

// ─── G — PASSIVE CONTROL (P4) ────────────────────────────────
// Not a scoring model. A named do-nothing baseline the P4
// experiment persists so every leaderboard reports both a
// zero-effort control AND the challenger models under the same
// forward-horizon rules. G's "picks" are the passive tickers held
// for the horizon; alpha vs itself is 0 by construction.
SCORING_MODELS.G = {
  id: "G", label: "Passive control (XEQT/VTI/XIC/SPY)",
  opportunityWeights: null, entryWeights: null, combineWeights: null,
  criticalFactors: [],
  passiveTickers: ["XEQT.TO", "XIC.TO", "SPY", "VTI"],
  description: "Named passive control. Never scores individual stocks. Used to ask: could Richard have beaten a naive passive allocation?",
};

export const CHAMPION_MODEL_ID = "A";
export const ALL_MODEL_IDS = ["A", "B", "C", "D", "E", "F"];        // scoring models
export const ALL_P4_MODEL_IDS = ["A", "B", "C", "D", "E", "F", "G"]; // P4 leaderboard incl. passive control

// P4 nomination lanes — each lane independently proposes candidates;
// the union enters Stage-2 scoring. Persisted with every pick record
// so we can measure lane effectiveness downstream (spec §4).
export const P4_NOMINATION_LANES = [
  "TECHNICAL",         // legacy technical rank (chart / breakout / RS)
  "REVISION",          // real EPS/revenue revision movers
  "QUALITY_GROWTH",    // top-quintile fundamentals + growth accelerating
  "RELATIVE_STRENGTH", // 3m/6m RS vs benchmark (raw)
  "INDUSTRY_LEADER",   // top-quartile industry group + leader within it
  "POST_EARNINGS",     // recent surprise + post-earnings drift signal
  "CATALYST",          // material catalyst (structured, not sentiment)
];

// P4 funnel widths — reuse the P2.6 tournament variants; NARROW is
// production, MEDIUM/WIDE are shadow. Named here so the frozen
// experiment definition and the pick records agree on the enum.
export const P4_FUNNEL_VARIANTS = ["NARROW", "MEDIUM", "WIDE"];

// P4 exit-rule variants (shadow positions ONLY). Real trading is
// unchanged until an experiment result triggers a policy change.
export const P4_EXIT_RULES = [
  { id: "TRAIL_08", trailPct: 8,  method: "PCT_TRAIL" },
  { id: "TRAIL_10", trailPct: 10, method: "PCT_TRAIL" },
  { id: "TRAIL_12", trailPct: 12, method: "PCT_TRAIL" },  // production default
  { id: "TRAIL_15", trailPct: 15, method: "PCT_TRAIL" },
  { id: "ATR_2X",   method: "ATR_MULTIPLE", atrMultiple: 2 },
  { id: "THESIS_ONLY", method: "THESIS_INVALIDATION_ONLY" },
  { id: "TIME_20D", method: "FIXED_TIME", daysHeld: 20 },
];

// P4 shadow-portfolio rules — identical across A-F so a model can't
// win merely by taking more risk or holding more names.
export const P4_SHADOW_PORTFOLIO_RULES = {
  startingCapitalCad: 100_000,
  maxPositions: 15,
  maxPositionWeight: 0.15,
  cashDragBenchmark: "XEQT.TO",
  transactionCostBps: 10,        // 10bps per side, symmetric
  fxAssumption: "spot-at-fill",
  sleeveBudget: { CORE: 0.50, INCOME: 0.15, SWING: 0.25, SPEC: 0.10 },
};

// Preregistered promotion criteria — reviewed BEFORE outcomes arrive
// so we don't p-hack the finish line. Every threshold is deliberately
// conservative so a burst of luck can't promote a challenger.
export const P4_PROMOTION_CRITERIA = {
  minQualifiedObservations: 30,
  minMature20dObservations: 20,
  minPositiveMedianAlpha20dPp: 0.5,   // beats zero, not just noise
  minPositiveMeanAlpha20dPp: 0.5,
  mustBeatChampionMedianPp: 1.0,      // ≥ 1pp better than A at same horizon
  mustBeatPassiveMedianPp: 0.5,       // ≥ 0.5pp better than XEQT
  maxDrawdownPct: 15,
  robustWithoutTopWinner: true,       // ranking survives removing best pick
  minSectorsCovered: 2,
  minRegimesCovered: 1,               // relaxed while we accumulate history
};

// Validate that weight bundles sum to ~1.0 at import time. Model G
// (passive control) is exempt — it has no weights by design.
function validate() {
  for (const [id, m] of Object.entries(SCORING_MODELS)) {
    if (!m.opportunityWeights || !m.entryWeights || !m.combineWeights) continue;
    const owSum = Object.values(m.opportunityWeights).reduce((a, b) => a + b, 0);
    const ewSum = Object.values(m.entryWeights).reduce((a, b) => a + b, 0);
    const cwSum = m.combineWeights.opportunity + m.combineWeights.entry;
    if (Math.abs(owSum - 1) > 0.02) throw new Error(`Scoring model ${id}: opportunityWeights sum to ${owSum} (expected 1.0)`);
    if (Math.abs(ewSum - 1) > 0.02) throw new Error(`Scoring model ${id}: entryWeights sum to ${ewSum} (expected 1.0)`);
    if (Math.abs(cwSum - 1) > 0.02) throw new Error(`Scoring model ${id}: combineWeights sum to ${cwSum} (expected 1.0)`);
  }
}
validate();

export function getModel(id) {
  const m = SCORING_MODELS[id];
  if (!m) throw new Error(`Unknown scoring model id: ${id}`);
  return m;
}
