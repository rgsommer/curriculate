// backend/services/stocksTradingRegime.js
//
// Trading-regime detector: categorizes the current tape as
// TRENDING / CHOPPY / NEUTRAL and emits the strategy bias the AI
// briefing should prefer today.
//
//   TRENDING  → trend-following setups win: bull flag, pocket pivot,
//               VCP, MTF-aligned breakouts, coiled spring
//   CHOPPY    → mean-reversion setups win: RSI oversold at support,
//               gap-fill fades, range-bound support tests
//   NEUTRAL   → mixed: use both, but scale sizing down (bias to core
//               dividend + sleeve balance rather than tactical picks)
//
// Inputs (already computed elsewhere in the briefing pipeline):
//   macroContext.regime  (has volatility bucket + risk_appetite)
//   macroContext.snap    (has VIX, SPY, TNX)
//   fedLiquidity         (has regime risk-on/neutral/risk-off)
//
// Deliberately does NOT fetch fresh data — reuses what the briefing
// already pulled so we don't add latency to the daily cron.

const REGIME_TRENDING = "trending";
const REGIME_CHOPPY = "choppy";
const REGIME_NEUTRAL = "neutral";

const STRATEGY_TREND = "trend-following";
const STRATEGY_MEAN_REVERT = "mean-reversion";
const STRATEGY_MIXED = "mixed";

// Return { regime, strategy, confidence: 0..1, drivers[], preferSetups[], avoidSetups[] }
export function computeTradingRegime({ macroContext, fedLiquidity } = {}) {
  const snap = macroContext?.snap || {};
  const macroRegime = macroContext?.regime || {};
  const vixLast = snap["^VIX"]?.last;
  const vixChange5d = snap["^VIX"]?.change5d;
  const spx = snap["^GSPC"] || {};
  const spxChange5d = spx.change5d;
  const spxChange30d = spx.change30d;

  const drivers = [];
  let trendScore = 0;
  let chopScore = 0;

  // Rule 1: VIX absolute level
  if (Number.isFinite(vixLast)) {
    if (vixLast < 15) { trendScore += 2; drivers.push(`VIX ${vixLast.toFixed(1)} < 15 (calm — trend-following favored)`); }
    else if (vixLast < 20) { trendScore += 1; drivers.push(`VIX ${vixLast.toFixed(1)} 15-20 (normal)`); }
    else if (vixLast < 25) { chopScore += 1; drivers.push(`VIX ${vixLast.toFixed(1)} 20-25 (elevated — chop risk rising)`); }
    else { chopScore += 2; drivers.push(`VIX ${vixLast.toFixed(1)} ≥ 25 (high — mean-reversion favored)`); }
  }

  // Rule 2: VIX 5d direction (spikes = chop)
  if (Number.isFinite(vixChange5d)) {
    if (vixChange5d > 20) { chopScore += 1; drivers.push(`VIX +${vixChange5d.toFixed(0)}% in 5d (fear spike)`); }
    else if (vixChange5d < -20) { trendScore += 1; drivers.push(`VIX ${vixChange5d.toFixed(0)}% in 5d (fear draining)`); }
  }

  // Rule 3: SPY smooth trend (both 5d and 30d in the same direction, no big
  // whipsaws) = trending; opposite signs = choppy
  if (Number.isFinite(spxChange5d) && Number.isFinite(spxChange30d)) {
    const sameDir = (spxChange5d > 0 && spxChange30d > 0) || (spxChange5d < 0 && spxChange30d < 0);
    if (sameDir && Math.abs(spxChange30d) > 3) {
      trendScore += 1;
      drivers.push(`SPX ${spxChange5d.toFixed(1)}% 5d and ${spxChange30d.toFixed(1)}% 30d (same direction, sustained)`);
    } else if (!sameDir && Math.abs(spxChange30d) < 3) {
      chopScore += 1;
      drivers.push(`SPX ${spxChange5d.toFixed(1)}% 5d vs ${spxChange30d.toFixed(1)}% 30d (divergent, range-bound)`);
    }
  }

  // Rule 4: Fed liquidity — risk-off amplifies chop bias
  if (fedLiquidity?.regime === "risk-off") { chopScore += 1; drivers.push(`Fed liquidity risk-off (${fedLiquidity.score})`); }
  else if (fedLiquidity?.regime === "risk-on") { trendScore += 1; drivers.push(`Fed liquidity risk-on (+${fedLiquidity.score})`); }

  // Rule 5: risk_appetite macro tag as tiebreak
  if (macroRegime.risk_appetite === "risk-on (growth bias)") trendScore += 0.5;
  else if (macroRegime.risk_appetite === "risk-off (defensive bias)") chopScore += 0.5;

  const total = trendScore + chopScore;
  let regime, strategy, confidence;
  if (total === 0) {
    regime = REGIME_NEUTRAL;
    strategy = STRATEGY_MIXED;
    confidence = 0;
  } else if (trendScore > chopScore * 1.5) {
    regime = REGIME_TRENDING;
    strategy = STRATEGY_TREND;
    confidence = Math.min(1, trendScore / (total + 1));
  } else if (chopScore > trendScore * 1.5) {
    regime = REGIME_CHOPPY;
    strategy = STRATEGY_MEAN_REVERT;
    confidence = Math.min(1, chopScore / (total + 1));
  } else {
    regime = REGIME_NEUTRAL;
    strategy = STRATEGY_MIXED;
    confidence = 0.4;
  }

  const preferSetups = regime === REGIME_TRENDING
    ? ["Bull Flag", "Pocket Pivot", "VCP", "Coiled Spring", "Inside Day (breakout side)", "Multi-timeframe aligned breakout"]
    : regime === REGIME_CHOPPY
      ? ["Support Test at 200-DMA", "RSI Oversold with Positive Divergence", "Gap-Fill Fade", "Range-Bound Bounce", "Overnight Reversal"]
      : ["Bull Flag (with tighter stop)", "Support Test (only near 200-DMA)"];

  const avoidSetups = regime === REGIME_TRENDING
    ? ["Fade-the-move mean-reversion (fights the trend)"]
    : regime === REGIME_CHOPPY
      ? ["Buy-the-breakout momentum (breakouts fail in chop)", "Pocket Pivots (need trend context)"]
      : ["High-conviction speculative bets (regime unclear)"];

  return { regime, strategy, confidence, drivers, preferSetups, avoidSetups };
}

// Compact block for injection into the AI briefing prompt.
export function formatTradingRegimeBlock(state) {
  if (!state?.regime) return "";
  const lines = [
    `\nTRADING REGIME (bias every setup selection today — the tape is telling you which strategy is likely to work):`,
    `  regime: ${state.regime.toUpperCase()} (${(state.confidence * 100).toFixed(0)}% confidence) → prefer ${state.strategy.toUpperCase()} strategy`,
    `  drivers:`,
  ];
  for (const d of state.drivers) lines.push(`    - ${d}`);
  lines.push(`  PREFER these setups today: ${state.preferSetups.join(", ")}`);
  lines.push(`  AVOID these setups today: ${state.avoidSetups.join(", ")}`);
  lines.push(``);
  lines.push(`Section 4 (Today's one action), section 7 (SPEC), section 8 (SWING picks): if the Test A / Discovery pool serves a setup in the AVOID list, prefer to SKIP it rather than emit it. If nothing in the pools matches the PREFER list, say "no clean setup for a ${state.strategy} regime today — pass" and don't force a pick just to fill the slot. Forcing counter-regime setups is a leading cause of the "took the pick, it faded" pattern in the setup scorecard.`);
  return lines.join("\n");
}
