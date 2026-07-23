// backend/services/stocksPyramidingMonitor.js
//
// Systematic add-on signals for winners. Retail underperforms in part
// because they trim winners early ("I made a little, let me lock it in
// before it reverses"). Pros pyramid — they add to positions that
// prove out, and trail the stop so partial gains are secured. This
// service produces add-on signals for the daily briefing.
//
// Rules (simple, transparent, back-testable):
//   Layer 1 (at +1R):  add 50% of the original position size,
//                      move stop to break-even + 0.25R
//   Layer 2 (at +2R):  add 25% of the original position size,
//                      move stop to +1R
//   Max 2 pyramid layers. Layer 3 would concentrate risk excessively
//   given the trader's Non-Spousal + RRSP + TFSA sleeve structure.
//
// R = (current - entry) / (entry - stop)  for a BUY
// Add-on shares are computed from the ORIGINAL entered share count so
// pyramid layers stay proportional to what the trader actually took.
//
// State: pyramidLayersAdded field on StocksDailyPick — 0/1/2. The
// briefing surfaces the signals; the trader manually records the
// add-on trade via Record Trade, and a small handler increments the
// counter so the same layer doesn't re-surface.

import StocksDailyPick from "../models/StocksDailyPick.js";

const LAYER1_TRIGGER_R = 1.0;
const LAYER2_TRIGGER_R = 2.0;
const LAYER1_ADD_MULTIPLIER = 0.5;
const LAYER2_ADD_MULTIPLIER = 0.25;
const MAX_LAYERS = 2;

// Compute pyramiding signals for one user. Returns an array of
// { pickId, ticker, currency, layer, currentPrice, currentR,
//   originalShares, addOnShares, oldStop, newStop, rationale }.
export async function computePyramidingSignals(email, { priceMap = {} } = {}) {
  // Only picks that (a) are still open, (b) have been entered by the
  // trader (enteredAt set), (c) have entry + stop + horizon known.
  // pyramidLayersAdded < MAX_LAYERS means at least one layer is still
  // eligible.
  const picks = await StocksDailyPick.find({
    email,
    status: "open",
    enteredAt: { $ne: null },
    entryPrice: { $gt: 0 },
    stopPrice: { $gt: 0 },
    enteredShares: { $gt: 0 },
    $or: [
      { pyramidLayersAdded: { $exists: false } },
      { pyramidLayersAdded: { $lt: MAX_LAYERS } },
    ],
  }).lean();
  if (picks.length === 0) return [];

  const signals = [];
  for (const p of picks) {
    const layersDone = p.pyramidLayersAdded || 0;
    const entry = p.enteredPrice || p.entryPrice;
    const stop = p.stopPrice;
    if (!(entry > stop)) continue; // long side only
    const initialRisk = entry - stop;
    const current = pickPriceFor(p, priceMap);
    if (!Number.isFinite(current)) continue;
    const currentR = (current - entry) / initialRisk;

    let layer = null;
    let addMultiplier = 0;
    let newStop = null;
    let rationale = "";
    if (layersDone === 0 && currentR >= LAYER1_TRIGGER_R) {
      layer = 1;
      addMultiplier = LAYER1_ADD_MULTIPLIER;
      newStop = entry + 0.25 * initialRisk; // break-even + 0.25R
      rationale = `Position at +${currentR.toFixed(2)}R (initial risk $${initialRisk.toFixed(2)}). Add ${Math.round(LAYER1_ADD_MULTIPLIER * 100)}% of original size; move stop to break-even + 0.25R to secure partial gains.`;
    } else if (layersDone === 1 && currentR >= LAYER2_TRIGGER_R) {
      layer = 2;
      addMultiplier = LAYER2_ADD_MULTIPLIER;
      newStop = entry + 1.0 * initialRisk; // +1R
      rationale = `Position at +${currentR.toFixed(2)}R after first pyramid layer. Add ${Math.round(LAYER2_ADD_MULTIPLIER * 100)}% of original size; move stop to +1R (locks in initial risk as profit).`;
    }
    if (layer == null) continue;

    const addOnShares = Math.max(1, Math.floor((p.enteredShares || 0) * addMultiplier));
    signals.push({
      pickId: String(p._id),
      ticker: p.ticker,
      currency: p.currency || "USD",
      layer,
      currentPrice: current,
      currentR,
      originalShares: p.enteredShares,
      addOnShares,
      oldStop: stop,
      newStop,
      entry,
      rationale,
    });
  }
  // Highest R first — those are the most-earned add-on layers.
  signals.sort((a, b) => b.currentR - a.currentR);
  return signals;
}

function pickPriceFor(p, priceMap) {
  const t = String(p.ticker || "").toUpperCase();
  // Prefer exact ticker match; then base ticker match against any key
  // in the price map (SU vs SU.TO).
  if (priceMap[t] != null) return priceMap[t];
  const base = t.replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
  for (const k of Object.keys(priceMap)) {
    const kBase = String(k).toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
    if (kBase === base) return priceMap[k];
  }
  return p.lastCheckedPrice ?? null;
}

// Format the add-on block for the AI briefing prompt.
export function formatPyramidingBlock(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return "";
  const lines = ["\nPYRAMIDING ADD-ON SIGNALS (winners that have moved through their +1R / +2R thresholds — the trader has systematic pyramiding on):"];
  for (const s of signals) {
    const cur = `$${s.currentPrice.toFixed(2)} ${s.currency}`;
    const oldStop = `$${s.oldStop.toFixed(2)}`;
    const newStop = `$${s.newStop.toFixed(2)}`;
    lines.push(`  ${s.ticker} · Layer ${s.layer} @ +${s.currentR.toFixed(2)}R (entry $${s.entry.toFixed(2)}, now ${cur}) → ADD ${s.addOnShares} sh, MOVE STOP from ${oldStop} → ${newStop}. ${s.rationale}`);
  }
  lines.push("\nEmit these as first-class recs in section 4 (Today's one action) or a dedicated \"## 🪜 Add-on signals\" section — pyramiding is intentional strategy, not incidental. Format each as: \"ADD N sh TICKER @ market, MOVE STOP TICKER to $X (from $Y)\". Include the R multiple and the layer number so the trader knows what phase they're in. If the underlying has an earnings date inside 3 trading days, SKIP the layer — a post-earnings gap can reverse the R in one bar.");
  return lines.join("\n");
}
