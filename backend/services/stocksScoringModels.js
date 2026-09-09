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

  // ─── D — GARP + REVISIONS + MOMENTUM ───────────────────────
  D: {
    id: "D", label: "GARP + revisions + momentum",
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
    description: "Growth-at-a-reasonable-price + revisions + momentum. Fundamentals AND growth both critical.",
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

export const CHAMPION_MODEL_ID = "A";
export const ALL_MODEL_IDS = ["A", "B", "C", "D", "E", "F"];

// Validate that weight bundles sum to ~1.0 at import time.
function validate() {
  for (const [id, m] of Object.entries(SCORING_MODELS)) {
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
