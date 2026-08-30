// backend/jobs/stocksRecOutcomeNightly.js
//
// Phase 2 of the Stocks Advisor rewrite: nightly mark-to-market of
// every open rec across every user, plus a horizon-expiry sweep.
//
// Why nightly + separate from monitorOpenRecs (which runs inside the
// briefing pipeline):
//   • monitorOpenRecs only fires when a user's briefing runs. Users
//     without a briefing cadence (or a paused briefing) leave their
//     open recs untouched, and their alpha stats decay silently.
//   • The alpha dashboard reads outcome fields (status, hitAt,
//     hitPrice, lastCheckedPrice, lastCheckedAt) — those need to be
//     fresh regardless of briefing state.
//   • Horizon-exit (rec has been open past horizonDays with neither
//     target nor stop hit) needs a deterministic sweep or open recs
//     accumulate forever and the alpha calc drifts toward "everything
//     is open, nothing has closed."
//
// Runs once a day at 04:15 America/Toronto (before the 07:30 morning
// briefing). Uses the market-data integrity layer for every price so
// $0 / stale / disagreeing quotes never poison the outcome fields.

import cron from "node-cron";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import { getVerifiedPrice } from "../services/marketDataIntegrity.js";

const HORIZON_GRACE_DAYS = 3; // don't expire recs the moment horizon passes; add a small grace for weekend edges

// Same shape as monitorOpenRecs.recSymbol — pick TSX listing for CAD
// recs, US listing otherwise. Duplicated to keep the cron
// self-contained (avoid a bulk import from the giant briefing file).
function recExchangeSym(rec) {
  const bare = String(rec.ticker || "").toUpperCase();
  if (!bare) return null;
  if (bare.includes(".")) return bare;
  return rec.entryCurrency === "CAD" ? `${bare}.TO` : bare;
}

// Was target hit? BUY targets are "price ≥ target"; SELL/TRIM are
// "price ≤ target" (target = buy-back level for the operator).
function targetHit(rec, price) {
  if (!Number.isFinite(rec.targetPrice) || rec.targetPrice <= 0) return false;
  if (rec.action === "BUY" || rec.action === "HOLD") return price >= rec.targetPrice;
  return price <= rec.targetPrice;
}
function stopHit(rec, price) {
  if (!Number.isFinite(rec.stopPrice) || rec.stopPrice <= 0) return false;
  if (rec.action === "BUY" || rec.action === "HOLD") return price <= rec.stopPrice;
  return price >= rec.stopPrice;
}

function pastHorizon(rec, now) {
  if (!rec.horizonDays || !rec.generatedAt) return false;
  const age = (now - new Date(rec.generatedAt).getTime()) / 86400000;
  return age > (rec.horizonDays + HORIZON_GRACE_DAYS);
}

// Sweep one user's open recs. Batches price fetches per unique
// exchange symbol (dedup) so a user with 20 open recs on 8 distinct
// tickers makes 8 network calls, not 20.
//
// Tier 4 (audit Aug-28): also pulls in CLOSED recs that are still
// within their 90-day post-exit tracking window. Purpose: measure
// "did we sell a winner too early?" by keeping the peak-after-exit
// updated for 90 days after status flipped. Adds no user-facing
// cost; the price fetch is deduped against the open-rec set.
async function sweepUser(email) {
  const openRecs = await StocksAdviceRec.find({ email, status: "open" }).lean();
  const postExitRecs = await StocksAdviceRec.find({
    email,
    status: { $in: ["target-hit", "stop-hit", "expired"] },
    // Track for 90 days after status flip. postExitTrackingUntil is
    // set when status first transitions; if it's not set yet on a
    // legacy rec, fall back to hitAt + 90d in the filter path.
    $or: [
      { postExitTrackingUntil: { $gte: new Date() } },
      {
        postExitTrackingUntil: null,
        hitAt: { $gte: new Date(Date.now() - 90 * 86400000) },
      },
    ],
  }).lean();
  const allRecs = [...openRecs, ...postExitRecs];
  if (allRecs.length === 0) return { checked: 0, targetHit: 0, stopHit: 0, expired: 0, mfeMaeUpdated: 0, postExitTracked: 0 };

  const symBy = new Map(); // resolvedSymbol → { ccy, recs[] }
  for (const rec of allRecs) {
    const sym = recExchangeSym(rec);
    if (!sym) continue;
    if (!symBy.has(sym)) symBy.set(sym, { ccy: rec.entryCurrency || "USD", recs: [] });
    symBy.get(sym).recs.push(rec);
  }

  // Fetch verified prices in parallel; single-tick cache in the
  // integrity layer keeps concurrent fetches to the same symbol from
  // hitting the API twice.
  const priceBy = new Map();
  await Promise.all([...symBy.entries()].map(async ([sym, meta]) => {
    try {
      const v = await getVerifiedPrice(sym, meta.ccy);
      if (v.ok) priceBy.set(sym, v.price);
    } catch (e) {
      console.warn(`[rec-outcome] getVerifiedPrice failed for ${sym}:`, e?.message);
    }
  }));

  const now = Date.now();
  const nowDate = new Date(now);
  let checked = 0, tHit = 0, sHit = 0, expired = 0;
  let mfeMaeUpdated = 0, postExitTracked = 0;

  const bulkOps = [];
  // ── OPEN recs — status transition, MFE/MAE, lastPnl ─────────
  for (const rec of openRecs) {
    const sym = recExchangeSym(rec);
    const px = priceBy.get(sym);
    if (px == null) continue;
    checked++;

    // Compute signed unrealized P/L% for the alpha dashboard.
    let pnlPct = null;
    if (Number.isFinite(rec.entryPrice) && rec.entryPrice > 0) {
      const raw = ((px - rec.entryPrice) / rec.entryPrice) * 100;
      const isLong = rec.action === "BUY" || rec.action === "HOLD";
      pnlPct = isLong ? raw : -raw;
    }

    let newStatus = "open";
    let hitPrice = null;
    let hitAt = null;
    if (targetHit(rec, px)) { newStatus = "target-hit"; hitPrice = px; hitAt = nowDate; tHit++; }
    else if (stopHit(rec, px)) { newStatus = "stop-hit"; hitPrice = px; hitAt = nowDate; sHit++; }
    else if (pastHorizon(rec, now)) { newStatus = "expired"; hitPrice = px; hitAt = nowDate; expired++; }

    const setFields = {
      lastCheckedAt: nowDate,
      lastCheckedPrice: px,
      lastScoredAt: nowDate,
      lastScoredPrice: px,
    };
    if (pnlPct != null) setFields.lastPnlPct = pnlPct;

    // Tier 4 MFE/MAE tracking (audit Aug-28). Compare today's px to
    // rec.peakPrice / rec.troughPrice (which may be null on first
    // touch). "Best" = highest for BUY, lowest for SELL.
    if (Number.isFinite(rec.entryPrice) && rec.entryPrice > 0 && pnlPct != null) {
      const isLong = rec.action === "BUY" || rec.action === "HOLD";
      const currentBest = rec.peakPrice;
      const currentWorst = rec.troughPrice;
      // Determine "best" and "worst" from the direction. For BUY, best=max, worst=min.
      const isNewBest = currentBest == null
        || (isLong ? px > currentBest : px < currentBest);
      const isNewWorst = currentWorst == null
        || (isLong ? px < currentWorst : px > currentWorst);
      if (isNewBest) {
        setFields.peakPrice = px;
        setFields.peakPct = pnlPct;
        setFields.peakAt = nowDate;
        mfeMaeUpdated++;
      }
      if (isNewWorst) {
        setFields.troughPrice = px;
        setFields.troughPct = pnlPct;
        setFields.troughAt = nowDate;
        mfeMaeUpdated++;
      }
    }

    if (newStatus !== "open") {
      setFields.status = newStatus;
      setFields.hitPrice = hitPrice;
      setFields.hitAt = hitAt;
      // Start post-exit tracking window — 90 days after status flip.
      setFields.postExitTrackingUntil = new Date(now + 90 * 86400000);
      setFields.postExitPeakPct = 0; // reset from exit price
      setFields.postExitPeakAt = nowDate;
    }
    bulkOps.push({ updateOne: { filter: { _id: rec._id }, update: { $set: setFields } } });
  }

  // ── CLOSED recs (within 90d window) — post-exit peak tracking ──
  // Measures "did we sell a winner too early?" Compares current px vs
  // exit price; positive delta means the rec kept working after we
  // called it done.
  for (const rec of postExitRecs) {
    const sym = recExchangeSym(rec);
    const px = priceBy.get(sym);
    if (px == null || !Number.isFinite(rec.hitPrice) || rec.hitPrice <= 0) continue;
    postExitTracked++;
    const isLong = rec.action === "BUY" || rec.action === "HOLD";
    // Post-exit delta signed by direction. For a BUY closed at $50 with
    // px now $60, postExitDelta = +20%. For a SELL closed at $50 with
    // px now $40, postExitDelta = +20% (the SELL was correct).
    const raw = ((px - rec.hitPrice) / rec.hitPrice) * 100;
    const postExitDelta = isLong ? raw : -raw;
    const setFields = {};
    const currentPeak = rec.postExitPeakPct;
    if (currentPeak == null || postExitDelta > currentPeak) {
      setFields.postExitPeakPct = postExitDelta;
      setFields.postExitPeakAt = nowDate;
    }
    // Backfill postExitTrackingUntil for legacy recs.
    if (!rec.postExitTrackingUntil && rec.hitAt) {
      setFields.postExitTrackingUntil = new Date(new Date(rec.hitAt).getTime() + 90 * 86400000);
    }
    if (Object.keys(setFields).length > 0) {
      bulkOps.push({ updateOne: { filter: { _id: rec._id }, update: { $set: setFields } } });
    }
  }

  if (bulkOps.length > 0) {
    await StocksAdviceRec.bulkWrite(bulkOps, { ordered: false });
  }
  return { checked, targetHit: tHit, stopHit: sHit, expired, mfeMaeUpdated, postExitTracked };
}

// Public: mark-to-market every open rec for every user.
export async function runRecOutcomeSweep() {
  const users = await StocksPortfolio.find({}).select({ email: 1 }).lean();
  let total = { users: 0, checked: 0, targetHit: 0, stopHit: 0, expired: 0, mfeMaeUpdated: 0, postExitTracked: 0 };
  for (const u of users) {
    if (!u?.email) continue;
    try {
      const r = await sweepUser(u.email);
      total.users++;
      total.checked += r.checked;
      total.targetHit += r.targetHit;
      total.stopHit += r.stopHit;
      total.expired += r.expired;
      total.mfeMaeUpdated += r.mfeMaeUpdated || 0;
      total.postExitTracked += r.postExitTracked || 0;
    } catch (e) {
      console.warn(`[rec-outcome] sweep failed for ${u.email}:`, e?.message);
    }
  }
  console.log(`[rec-outcome] nightly sweep — users=${total.users} checked=${total.checked} target-hit=${total.targetHit} stop-hit=${total.stopHit} expired=${total.expired} mfe-mae-updated=${total.mfeMaeUpdated} post-exit-tracked=${total.postExitTracked}`);
  return total;
}

export function scheduleRecOutcomeNightly() {
  if (process.env.STOCKS_REC_OUTCOME_ENABLED !== "1") {
    console.log("[rec-outcome] disabled (set STOCKS_REC_OUTCOME_ENABLED=1 to turn on)");
    return null;
  }
  // 04:15 America/Toronto — well before the 07:30 morning briefing so
  // outcomes are fresh when the briefing reads them.
  console.log("[rec-outcome] scheduled nightly at 04:15 America/Toronto");
  return cron.schedule("15 4 * * *", async () => {
    try { await runRecOutcomeSweep(); }
    catch (e) { console.error("[rec-outcome] nightly tick error:", e); }
  }, { timezone: "America/Toronto" });
}
