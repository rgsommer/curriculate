// backend/services/stocksReplacementPairing.js
//
// P3.5 (2026-09-09) — provenance-based replacement pairing.
//
// P3 paired every same-account SELL + BUY within 3 days as a
// "replacement trade". That is too loose: a routine sell to raise cash
// followed by an unrelated buy in the same account is not a rotation.
//
// Now: strongest provenance first, temporal inference last-resort
// with explicit LOW-confidence tag.
//
//   1  EXPLICIT_REDEPLOY       — sell rec.linkedAdviceRec matches
//                                 buy rec.linkedAdviceRec sourceLabel
//                                 startsWith "trail-stop-if-exit-redeploy"
//                                 or "confirmed-stop-core-deploy" or
//                                 "trim-redeploy" (mandate factory
//                                 stamps these).
//   2  SAME_MANDATE_BATCH      — both linkedAdviceRec sourceLabel
//                                 references the same "briefing-cron"
//                                 generation timestamp (within same tick).
//   3  LINKED_ADVICE_REC       — buy.linkedAdviceRec.rationale or
//                                 accompanying doc mentions the sold ticker
//                                 by string match.
//   4  DECISION_ENGINE_TAG     — buy row carries `replacementFor: <ticker>`
//                                 set by the P1 decision engine (future
//                                 wiring; recognized when present).
//   5  TEMPORAL                — SELL + BUY same account within 3d.
//                                 Confidence LOW. Never mixed with 1-4
//                                 in aggregate metrics without a flag.
//
// Each pair persists `pairingMethod` and `pairingConfidence` in the
// returned row so the attribution engine can filter or subset.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const PAIRING_METHODS = {
  EXPLICIT_REDEPLOY: { rank: 1, confidence: "HIGH" },
  SAME_MANDATE_BATCH: { rank: 2, confidence: "HIGH" },
  LINKED_ADVICE_REC: { rank: 3, confidence: "MEDIUM" },
  DECISION_ENGINE_TAG: { rank: 4, confidence: "HIGH" },
  TEMPORAL: { rank: 5, confidence: "LOW" },
};

const REDEPLOY_LABEL_PREFIXES = [
  "mandate:trail-stop-if-exit-redeploy",
  "mandate:confirmed-stop-core-deploy",
  "mandate:trim-redeploy",
  "mandate:trim-spec-core-deploy",
];

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// PUBLIC — pair SELL/BUY events over a window using provenance first.
// Returns { pairs, coverage, methodCounts }.
export async function pairReplacementTrades({ email, fromYmd, toYmd, asOf = new Date() }) {
  const trades = await StocksTradeJournal.find({
    email: String(email || "").toLowerCase(),
    executedAt: { $gte: new Date(fromYmd), $lte: new Date(toYmd + "T23:59:59Z") },
  }).sort({ executedAt: 1 }).lean();

  // Collect SELL + BUY legs.
  const sells = [], buys = [];
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (!leg.ticker || !(leg.shares > 0) || !(leg.pricePerShare > 0)) continue;
      const shared = {
        tradeId: t._id, executedAt: t.executedAt,
        account: t.account || "", accountName: t.accountName || "",
        recId: t.linkedAdviceRecId || null,
        ticker: String(leg.ticker).toUpperCase(),
        shares: leg.shares, price: leg.pricePerShare, currency: leg.currency,
        fx: t.fxUsdCadAtTrade,
      };
      if (leg.side === "SELL") sells.push(shared);
      else if (leg.side === "BUY") buys.push(shared);
    }
  }

  // Preload the recs referenced by any trade in the window (batch fetch).
  const recIds = [...new Set([...sells, ...buys].map(x => x.recId).filter(Boolean))].map(String);
  const recs = recIds.length > 0
    ? await StocksAdviceRec.find({ _id: { $in: recIds } }).lean().catch(() => [])
    : [];
  const recById = new Map(recs.map(r => [String(r._id), r]));

  const pairs = [];
  const usedSellIdx = new Set();
  const usedBuyIdx = new Set();

  // Walk sells; find the best available buy per one of the methods above.
  for (let si = 0; si < sells.length; si++) {
    if (usedSellIdx.has(si)) continue;
    const sell = sells[si];
    const sellRec = sell.recId ? recById.get(String(sell.recId)) : null;

    let matchIdx = -1, matchedBy = null;
    const candidates = buys
      .map((b, bi) => ({ b, bi }))
      .filter(({ bi }) => !usedBuyIdx.has(bi))
      .filter(({ b }) => b.account === sell.account)
      .filter(({ b }) => Math.abs(new Date(b.executedAt) - new Date(sell.executedAt)) <= 5 * 86400_000);

    // Method 1: explicit redeploy label. Sell rec belongs to a mandate
    // stop/exit and the buy rec's sourceLabel is one of the paired
    // redeploy labels.
    for (const { b, bi } of candidates) {
      const buyRec = b.recId ? recById.get(String(b.recId)) : null;
      if (!buyRec) continue;
      const bl = String(buyRec.sourceLabel || "").toLowerCase();
      if (REDEPLOY_LABEL_PREFIXES.some(p => bl.startsWith(p))) {
        matchIdx = bi; matchedBy = "EXPLICIT_REDEPLOY"; break;
      }
    }
    // Method 2: same mandate batch — same generatedAt (rounded to minute).
    if (matchIdx < 0 && sellRec?.generatedAt) {
      const stampSell = new Date(sellRec.generatedAt).toISOString().slice(0, 16);
      for (const { b, bi } of candidates) {
        const buyRec = b.recId ? recById.get(String(b.recId)) : null;
        if (!buyRec?.generatedAt) continue;
        const stampBuy = new Date(buyRec.generatedAt).toISOString().slice(0, 16);
        if (stampSell === stampBuy) {
          matchIdx = bi; matchedBy = "SAME_MANDATE_BATCH"; break;
        }
      }
    }
    // Method 3: linked-advice-rec rationale mentions the sold ticker.
    if (matchIdx < 0) {
      for (const { b, bi } of candidates) {
        const buyRec = b.recId ? recById.get(String(b.recId)) : null;
        if (!buyRec) continue;
        const hay = String(buyRec.rationale || "").toUpperCase();
        if (hay.includes(sell.ticker.replace(/\..*$/, ""))) {
          matchIdx = bi; matchedBy = "LINKED_ADVICE_REC"; break;
        }
      }
    }
    // Method 4: decision-engine tag (future — recognized when present).
    if (matchIdx < 0) {
      for (const { b, bi } of candidates) {
        const buyRec = b.recId ? recById.get(String(b.recId)) : null;
        const tag = buyRec?.replacementFor;
        if (tag && String(tag).toUpperCase() === sell.ticker) {
          matchIdx = bi; matchedBy = "DECISION_ENGINE_TAG"; break;
        }
      }
    }
    // Method 5: temporal fallback — narrower ±3 days and same account.
    if (matchIdx < 0) {
      const tempCand = candidates.filter(({ b }) =>
        Math.abs(new Date(b.executedAt) - new Date(sell.executedAt)) <= 3 * 86400_000);
      if (tempCand.length > 0) {
        matchIdx = tempCand[0].bi;
        matchedBy = "TEMPORAL";
      }
    }
    if (matchIdx < 0) continue;
    usedSellIdx.add(si); usedBuyIdx.add(matchIdx);
    pairs.push({
      soldTicker: sell.ticker, soldOn: ymd(sell.executedAt),
      soldPrice: sell.price, soldShares: sell.shares, soldCurrency: sell.currency,
      boughtTicker: buys[matchIdx].ticker, boughtOn: ymd(buys[matchIdx].executedAt),
      boughtPrice: buys[matchIdx].price, boughtShares: buys[matchIdx].shares,
      boughtCurrency: buys[matchIdx].currency,
      account: sell.account,
      pairingMethod: matchedBy,
      pairingConfidence: PAIRING_METHODS[matchedBy]?.confidence || "LOW",
    });
  }

  // Compute 20-day forward returns for each pair. Missing horizon → null.
  const HORIZON_D = 20;
  for (const p of pairs) {
    const forwardYmd = ymd(new Date(new Date(p.boughtOn).getTime() + HORIZON_D * 86400_000));
    if (forwardYmd > ymd(asOf)) { p.replacementValueAddedPp = null; p.note = "horizon-not-elapsed"; continue; }
    const [oldBars, newBars] = await Promise.all([
      fetchYahooDaily(p.soldTicker, "6mo").catch(() => null),
      fetchYahooDaily(p.boughtTicker, "6mo").catch(() => null),
    ]);
    const readAt = (bars, target) => {
      if (!Array.isArray(bars)) return null;
      const rev = [...bars].reverse();
      return rev.find(b => (b.date || "").slice(0, 10) <= target)?.close || null;
    };
    const oldFwd = readAt(oldBars, forwardYmd);
    const newFwd = readAt(newBars, forwardYmd);
    const oldR = oldFwd && p.soldPrice ? ((oldFwd - p.soldPrice) / p.soldPrice) * 100 : null;
    const newR = newFwd && p.boughtPrice ? ((newFwd - p.boughtPrice) / p.boughtPrice) * 100 : null;
    p.oldReturn20dPct = oldR;
    p.newReturn20dPct = newR;
    p.replacementValueAddedPp = Number.isFinite(oldR) && Number.isFinite(newR) ? newR - oldR : null;
  }
  const methodCounts = pairs.reduce((m, p) => { m[p.pairingMethod] = (m[p.pairingMethod] || 0) + 1; return m; }, {});
  return {
    pairs,
    coverage: {
      totalSells: sells.length,
      totalBuys: buys.length,
      matchedPairs: pairs.length,
      highConfidencePairs: pairs.filter(p => p.pairingConfidence === "HIGH").length,
      lowConfidencePairs: pairs.filter(p => p.pairingConfidence === "LOW").length,
    },
    methodCounts,
    note: "TEMPORAL pairs are LOW-CONFIDENCE and should be reported SEPARATELY from provenance-based pairs.",
  };
}
