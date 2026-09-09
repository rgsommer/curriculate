// backend/services/stocksScoringModels.js
//
// P2 (2026-09-08) — declares the pluggable scoring configurations used
// by stocksOpportunityScore + stocksEntryScore. Each model is a
// {opportunityWeights, entryWeights, combineWeights} triple. The
// production engine still uses model A (CHAMPION) to select today's
// picks so P0B, P1 and P1-HARDENING behaviour is unchanged; the other
// models compute and PERSIST scores alongside the champion so P4
// shadow-portfolio testing can measure whether any of them
// out-selects the champion.
//
// The architecture P2 enforces:
//
//   OPPORTUNITY QUALITY (WHAT)     — driven by fundamentals, growth,
//                                    estimate revisions, quality,
//                                    relative + industry strength,
//                                    insider signals, catalyst
//   ENTRY QUALITY      (WHEN)      — driven by trend, setup, MTF,
//                                    RSI, RVOL, R:R, price extension
//
// A wonderful company with poor entry timing is a WATCH — HIGH-QUALITY
// / ENTRY-NOT-READY row, NOT a rejected candidate.
//
// A mediocre company with a beautiful chart is NOT a high-conviction
// BUY — the champion combine weights opportunity ≥ entry.

// Weights inside each of `opportunityWeights` and `entryWeights` must
// sum to ~1.0. `combineWeights` maps how the two sub-scores merge into
// a single composite for the model.
export const SCORING_MODELS = {
  // ─── A — CURRENT / CHAMPION ────────────────────────────────
  // The historical composite: technical 40 / fundamentals 15 /
  // growth 15 / revisions 10 / RS 15 / insider 5. Preserved so P4
  // has a control for shadow testing. Split into OQ + EQ for
  // reporting only — the champion picks by composite, not OQ/EQ.
  A: {
    id: "A", label: "Current / champion",
    opportunityWeights: {
      fundamentals: 0.30, growth: 0.30, revisions: 0.20,
      relativeStrength: 0.15, insider: 0.05, industryStrength: 0.00,
    },
    entryWeights: {
      trend: 0.35, setup: 0.30, mtf: 0.15, rsi: 0.10, rvol: 0.10, extension: 0.00,
    },
    combineWeights: { opportunity: 0.40, entry: 0.60 }, // preserves champion 40T / 60 rest -> equivalent bias
    description: "Preserves current 40% technical / 60% fundamentals+growth+rev+RS+insider weighting split cast as OQ/EQ combine.",
  },

  // ─── B — QUALITY + MOMENTUM ────────────────────────────────
  // Underlying quality (FCF, ROE, debt discipline, growth) + trend
  // participation. Entry is present but not dominant.
  B: {
    id: "B", label: "Quality + momentum",
    opportunityWeights: {
      fundamentals: 0.35, growth: 0.20, revisions: 0.10,
      relativeStrength: 0.20, insider: 0.05, industryStrength: 0.10,
    },
    entryWeights: {
      trend: 0.45, setup: 0.15, mtf: 0.15, rsi: 0.10, rvol: 0.10, extension: 0.05,
    },
    combineWeights: { opportunity: 0.65, entry: 0.35 },
    description: "Prefers underlying quality with a trend requirement — entry is a filter, not the selection driver.",
  },

  // ─── C — REVISIONS + MOMENTUM ──────────────────────────────
  // Anchored in estimate revisions (arguably the strongest single
  // published-alpha factor). Entry mostly trend + MTF.
  C: {
    id: "C", label: "Revisions + momentum",
    opportunityWeights: {
      fundamentals: 0.15, growth: 0.20, revisions: 0.35,
      relativeStrength: 0.15, insider: 0.05, industryStrength: 0.10,
    },
    entryWeights: {
      trend: 0.40, setup: 0.20, mtf: 0.20, rsi: 0.10, rvol: 0.10, extension: 0.00,
    },
    combineWeights: { opportunity: 0.60, entry: 0.40 },
    description: "Weights estimate revisions heavily; picks companies with fresh analyst confirmation of accelerating expectations.",
  },

  // ─── D — GARP + REVISIONS + MOMENTUM ───────────────────────
  // Growth-at-a-reasonable-price + confirming revisions + momentum.
  // Balanced.
  D: {
    id: "D", label: "GARP + revisions + momentum",
    opportunityWeights: {
      fundamentals: 0.25, growth: 0.25, revisions: 0.20,
      relativeStrength: 0.15, insider: 0.05, industryStrength: 0.10,
    },
    entryWeights: {
      trend: 0.35, setup: 0.25, mtf: 0.15, rsi: 0.10, rvol: 0.10, extension: 0.05,
    },
    combineWeights: { opportunity: 0.60, entry: 0.40 },
    description: "Balances fundamentals + growth + revisions and a real entry gate. Closest to the intent behind the P2 refactor.",
  },

  // ─── E — POST-EARNINGS DRIFT / CATALYST ────────────────────
  // Requires a real earnings catalyst (positive surprise, positive
  // guidance/rev, constructive post-print price action). Entry
  // weights emphasize RVOL + constructive holding of the gap.
  E: {
    id: "E", label: "Post-earnings drift / catalyst",
    opportunityWeights: {
      fundamentals: 0.15, growth: 0.20, revisions: 0.30,
      relativeStrength: 0.10, insider: 0.05, industryStrength: 0.20,
    },
    entryWeights: {
      trend: 0.20, setup: 0.20, mtf: 0.15, rsi: 0.05, rvol: 0.25, extension: 0.15,
    },
    combineWeights: { opportunity: 0.55, entry: 0.45 },
    description: "Catalyst-first — combines confirming rev/growth with entry emphasis on relative volume + non-extended gap holds.",
  },

  // ─── F — RELATIVE-STRENGTH LEADERS ─────────────────────────
  // Strong stock in strong industry with improving fundamentals.
  // Industry strength is heavily weighted here.
  F: {
    id: "F", label: "Relative-strength leaders",
    opportunityWeights: {
      fundamentals: 0.15, growth: 0.15, revisions: 0.15,
      relativeStrength: 0.25, insider: 0.05, industryStrength: 0.25,
    },
    entryWeights: {
      trend: 0.40, setup: 0.20, mtf: 0.20, rsi: 0.05, rvol: 0.10, extension: 0.05,
    },
    combineWeights: { opportunity: 0.60, entry: 0.40 },
    description: "Strong-stock-in-strong-industry leaders with underlying fundamentals confirming.",
  },
};

export const CHAMPION_MODEL_ID = "A";
export const ALL_MODEL_IDS = ["A", "B", "C", "D", "E", "F"];

// Validate a weight bundle — throw at import time on a broken model
// so a bad edit doesn't reach production silently.
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
