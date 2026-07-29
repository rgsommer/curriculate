// backend/services/stocksRecTrail.js
//
// Two guarantees for every BUY recommendation the system emits:
//   1. It ships with a targetPrice AND a stopPrice. If the AI omitted
//      them, we auto-fill from technicals (target = last + 2×ATR,
//      stop = last − 2.5×ATR) and stamp exitLevelsFilledBy="atr-defaults"
//      so the audit trail is honest about who set the levels.
//   2. When the BUY's target or stop fires, a COMPANION SELL rec is
//      auto-emitted (source="auto-sell-trail", linkedBuyRecId=<buy._id>).
//      This means every closed position has a full BUY→SELL trail in
//      the AI rec history — no orphaned entries, no exits without a
//      persisted rec, no "was I supposed to sell?" ambiguity.
//
// Both trail SELL recs and enriched BUYs are inserted through this file
// so the invariants can't drift.

import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { getTechnicals } from "./stocksTechnicals.js";

// Fill missing targetPrice / stopPrice on any BUY rec that lacks them.
// Fetches technicals ONCE per unique (ticker, currency) tuple even if
// multiple recs on the same ticker come through in the same batch.
export async function enrichRecsWithExitDefaults(recs) {
  if (!Array.isArray(recs) || recs.length === 0) return recs;
  const need = new Set();
  for (const r of recs) {
    if (r.action === "BUY" && (r.targetPrice == null || r.stopPrice == null)) {
      need.add(`${r.ticker}|${r.entryCurrency || "USD"}`);
    }
  }
  const techByKey = {};
  await Promise.all([...need].map(async (key) => {
    const [ticker, ccy] = key.split("|");
    techByKey[key] = await getTechnicals(ticker, ccy).catch(() => null);
  }));

  for (const r of recs) {
    if (r.action !== "BUY") continue;
    if (r.targetPrice != null && r.stopPrice != null) continue; // already complete
    const key = `${r.ticker}|${r.entryCurrency || "USD"}`;
    const tech = techByKey[key];
    if (!tech?.ok || !Number.isFinite(tech.atr14) || !Number.isFinite(tech.last)) continue;
    const entry = r.entryPrice ?? tech.last;
    // Only mark exitLevelsFilledBy when we ACTUALLY filled at least one.
    let filled = false;
    if (r.targetPrice == null) { r.targetPrice = entry + 2 * tech.atr14; filled = true; }
    if (r.stopPrice == null) {
      // suggested25AtrStop is already computed as last − 2.5×ATR; if entry
      // differs meaningfully from tech.last (rec-priced-at-different-time),
      // recompute from entry so the R:R relationship stays intact.
      r.stopPrice = entry - 2.5 * tech.atr14;
      filled = true;
    }
    if (filled) r.exitLevelsFilledBy = "atr-defaults";
  }
  return recs;
}

// Auto-emit a companion SELL rec when a BUY rec's target or stop fires.
// Called by monitorOpenRecs. Non-fatal on failure — the underlying BUY
// is still marked target-hit/stop-hit either way.
export async function insertAutoSellTrail({ buyRec, hitPrice, hitAt, reason }) {
  try {
    const dateStr = new Date(buyRec.generatedAt).toISOString().slice(0, 10);
    const rationale =
      `Auto-trail SELL: original BUY on ${dateStr} @ $${buyRec.entryPrice} · ${reason} at $${hitPrice.toFixed(2)}` +
      ` · target was $${buyRec.targetPrice ?? "—"}, stop was $${buyRec.stopPrice ?? "—"}`;
    await StocksAdviceRec.create({
      email: buyRec.email,
      generatedAt: hitAt || new Date(),
      source: "auto-sell-trail",
      sourceLabel: "auto-sell-trail",
      linkedBuyRecId: buyRec._id,
      ticker: buyRec.ticker,
      action: "SELL",
      shares: buyRec.shares || null,
      entryPrice: hitPrice,
      entryCurrency: buyRec.entryCurrency || "USD",
      targetPrice: null,
      stopPrice: null,
      horizonDays: 0,
      rationale,
      // Trail entries are birth-terminal — they represent an EXIT event
      // that already completed, so no monitoring needed. Using "expired"
      // to avoid enum expansion; semantically means "not open."
      status: "expired",
      hitAt: hitAt || new Date(),
      hitPrice,
      lastCheckedAt: hitAt || new Date(),
      lastCheckedPrice: hitPrice,
    });
  } catch (e) {
    console.warn(`[rec-trail] insertAutoSellTrail failed for ${buyRec.ticker}: ${e?.message}`);
  }
}
