// backend/services/stocksPositionSizing.js
//
// Vol-scaled / fractional-Kelly position sizing. Computes an optimal
// share count for a new rec by combining three constraints:
//
//   1. Risk budget: never lose more than riskPerTradePct of book on a
//      single trade if the stop hits. Sets an upper bound in dollars.
//   2. Vol scaling: shrink positions on high-vol names (ATR% > 2%) so
//      book vol stays consistent regardless of what's being traded.
//   3. Kelly gate: multiply by a fraction of the setup's proven
//      expectancy from StocksDailyPick history. Setups with no track
//      record → half size (learn cheap). Setups with negative
//      expectancy → quarter size or zero.
//
// Called once per rec by the daily briefing generator when the user
// has volSizingEnabled=true on their profile. Returns null when the
// inputs are insufficient (missing ATR, missing setup expectancy on a
// brand-new setup, etc.) so the caller can fall back to the AI's own
// share count.

import StocksDailyPick from "../models/StocksDailyPick.js";

// ── Config knobs (tunable per user via portfolio doc) ─────────────
const DEFAULT_RISK_PER_TRADE_PCT = 1.0;   // 1% of book at risk per trade
const DEFAULT_KELLY_FRACTION_CAP = 0.25;  // quarter-Kelly upper bound
const BASELINE_ATR_PCT = 2.0;             // ATR%/price where vol_mult = 1.0
const MIN_VOL_MULT = 0.25;                // never shrink below 25% of base
const MAX_VOL_MULT = 1.0;                 // never grow above baseline
const UNPROVEN_SETUP_MULT = 0.5;          // half size on setups with < N samples
const NEGATIVE_EXPECTANCY_MULT = 0.25;    // quarter size on losing setups
const MIN_SETUP_SAMPLES_FOR_PROVEN = 5;   // fewer than this = "unproven"

// Load per-setup expectancy stats from CLOSED daily picks in the last
// N days. Cached per email + window on the caller side if hit often
// during a briefing (we accept the DB round-trip here for simplicity).
export async function getSetupExpectancyMap(email, windowDays = 365) {
  const since = new Date(Date.now() - windowDays * 86400000);
  const picks = await StocksDailyPick.find({
    email,
    status: { $in: ["target-hit", "stop-hit", "horizon-exit"] },
    exitDate: { $gte: since },
    pnlPct: { $ne: null },
    setupName: { $ne: null, $ne: "" },
  }).select({ setupName: 1, pnlPct: 1 }).lean();

  const bySetup = new Map();
  for (const p of picks) {
    const key = p.setupName;
    if (!bySetup.has(key)) bySetup.set(key, { trades: 0, wins: 0, gains: [], winGains: [], lossGains: [] });
    const row = bySetup.get(key);
    row.trades++;
    row.gains.push(p.pnlPct);
    if (p.pnlPct > 0) { row.wins++; row.winGains.push(p.pnlPct); }
    else row.lossGains.push(p.pnlPct);
  }
  const out = {};
  const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  for (const [name, r] of bySetup.entries()) {
    const winRate = r.wins / r.trades;
    const avgWin = mean(r.winGains);
    const avgLoss = mean(r.lossGains); // negative
    const expectancyPct = (winRate * (avgWin || 0)) + ((1 - winRate) * (avgLoss || 0));
    out[name] = { trades: r.trades, winRate, avgWinPct: avgWin, avgLossPct: avgLoss, expectancyPct };
  }
  return out;
}

// Compute optimal size for one rec. Returns { shares, dollarSize,
// riskDollars, volMult, kellyMult, expectancyPct, rationale } or null
// on insufficient inputs.
//
// Inputs the caller must supply:
//   bookValueCad   — total portfolio value in CAD (equity + cash)
//   entryPrice     — proposed entry price in the trade's currency
//   stopPrice      — proposed stop price in the same currency
//   currency       — "USD" or "CAD"
//   fxUsdCad       — for converting USD entry to CAD-equivalent risk
//   atrPctOfPrice  — 14d ATR as % of price (from computeTechnicals)
//   setupName      — labeled setup ("Bull Flag", "Pocket Pivot", ...)
//   setupStats     — the map from getSetupExpectancyMap(email)
//   riskPerTradePct  (default 1.0)
//   kellyFractionCap (default 0.25)
export function computeOptimalSize({
  bookValueCad, entryPrice, stopPrice, currency, fxUsdCad = 1.37,
  atrPctOfPrice, setupName = null, setupStats = {},
  riskPerTradePct = DEFAULT_RISK_PER_TRADE_PCT,
  kellyFractionCap = DEFAULT_KELLY_FRACTION_CAP,
}) {
  if (!(bookValueCad > 0)) return null;
  if (!(entryPrice > 0) || !(stopPrice > 0)) return null;
  if (entryPrice <= stopPrice) return null; // stop must be below entry for a BUY
  if (!Number.isFinite(atrPctOfPrice) || atrPctOfPrice <= 0) return null;

  // 1) Risk budget in CAD
  const riskDollarsCad = bookValueCad * (riskPerTradePct / 100);
  // Convert to trade-currency risk dollars so shares math is clean
  const riskDollarsTradeCcy = currency === "USD" ? riskDollarsCad / fxUsdCad : riskDollarsCad;

  // 2) Base shares from stop distance
  const stopDistance = entryPrice - stopPrice;
  const baseShares = riskDollarsTradeCcy / stopDistance;
  const stopDistancePct = (stopDistance / entryPrice) * 100;

  // 3) Vol scaling — ATR% <= 2% → full size, higher → shrink linearly
  const rawVolMult = BASELINE_ATR_PCT / atrPctOfPrice;
  const volMult = Math.max(MIN_VOL_MULT, Math.min(MAX_VOL_MULT, rawVolMult));

  // 4) Kelly gate on setup expectancy
  let kellyMult;
  let expectancyPct = null;
  let expectancyBasis = "no-setup";
  if (setupName && setupStats[setupName]) {
    const s = setupStats[setupName];
    expectancyPct = s.expectancyPct;
    if (s.trades < MIN_SETUP_SAMPLES_FOR_PROVEN) {
      kellyMult = UNPROVEN_SETUP_MULT;
      expectancyBasis = `unproven (${s.trades} closed, need ${MIN_SETUP_SAMPLES_FOR_PROVEN}+)`;
    } else if (expectancyPct == null || expectancyPct <= 0) {
      kellyMult = NEGATIVE_EXPECTANCY_MULT;
      expectancyBasis = `negative-expectancy (${expectancyPct?.toFixed(2)}% avg)`;
    } else {
      // Scale linearly: highest observed positive expectancy gets full
      // kellyFractionCap; lower expectancy scales proportionally.
      const maxPositive = Object.values(setupStats)
        .filter(x => x.trades >= MIN_SETUP_SAMPLES_FOR_PROVEN && x.expectancyPct > 0)
        .reduce((m, x) => Math.max(m, x.expectancyPct), 0);
      const scale = maxPositive > 0 ? (expectancyPct / maxPositive) : 1.0;
      kellyMult = kellyFractionCap * scale;
      expectancyBasis = `proven (+${expectancyPct.toFixed(2)}% avg over ${s.trades} closed)`;
    }
  } else {
    // No setup tag or setup not yet observed — treat as unproven.
    kellyMult = UNPROVEN_SETUP_MULT;
    expectancyBasis = setupName ? `unproven-new (0 closed on "${setupName}")` : "no-setup";
  }

  const shares = Math.max(0, Math.floor(baseShares * volMult * kellyMult));
  const dollarSize = shares * entryPrice;

  return {
    shares,
    dollarSize,
    dollarSizeCad: currency === "USD" ? dollarSize * fxUsdCad : dollarSize,
    riskDollarsCad,
    stopDistancePct,
    volMult,
    kellyMult,
    expectancyPct,
    expectancyBasis,
    baseShares: Math.floor(baseShares),
    rationale: buildRationale({
      riskPerTradePct, riskDollarsCad, bookValueCad, stopDistancePct,
      baseShares: Math.floor(baseShares), volMult, atrPctOfPrice,
      kellyMult, expectancyBasis, shares, currency,
    }),
  };
}

function buildRationale({ riskPerTradePct, riskDollarsCad, bookValueCad, stopDistancePct, baseShares, volMult, atrPctOfPrice, kellyMult, expectancyBasis, shares, currency }) {
  return `Sized to ${shares} sh: risk $${Math.round(riskDollarsCad)} CAD (${riskPerTradePct.toFixed(1)}% of $${Math.round(bookValueCad).toLocaleString()} book) with a ${stopDistancePct.toFixed(1)}% stop → ${baseShares} base sh; vol-scaled ×${volMult.toFixed(2)} (ATR ${atrPctOfPrice.toFixed(1)}%); Kelly-gated ×${kellyMult.toFixed(2)} on ${expectancyBasis}.`;
}

// Build a compact block for injection into the AI briefing prompt so
// the model is forced to emit the computed share count (rather than
// improvising a round number). Called once per briefing with the list
// of picks the sizer has run on.
export function formatSizingBlock(sizedPicks) {
  if (!Array.isArray(sizedPicks) || sizedPicks.length === 0) return "";
  const lines = ["\nPOSITION SIZING (vol-scaled × fractional-Kelly — the trader's system pre-computed these; emit shares VERBATIM in every BUY rec below):"];
  for (const s of sizedPicks) {
    if (!s.sizing) continue;
    lines.push(`  ${s.ticker}: BUY ${s.sizing.shares} sh (~$${Math.round(s.sizing.dollarSize).toLocaleString()} ${s.currency} · ${s.sizing.rationale})`);
  }
  if (lines.length === 1) return "";
  lines.push("\nDo NOT round the share counts to '100' or '25' for visual neatness. If a rec's proposed size is 0, DROP the rec entirely — the sizer's negative-expectancy or over-vol filter rejected it.");
  return lines.join("\n");
}
