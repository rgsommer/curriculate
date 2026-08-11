// backend/services/questradeActivityPoller.js
//
// Read-only Questrade activity poller. Fetches recent trade activities
// per linked account, normalizes them to the same "alert" shape the
// CIBC email path uses, then hands off to the SAME planReconciliation
// + applyReconciledTrade code so both integrations produce identical
// journal rows. Rec-linking, account-inference, and celebrate-modal
// firing all reuse the CIBC path unchanged.
//
// Idempotency: the brokerReconcileKey unique index already blocks
// duplicate inserts, PLUS the poller keeps a lastActivityTs high-
// water mark to avoid re-fetching what it already processed.
//
// Windowing: Questrade caps activity queries at 31 days. Poller
// fetches the last 3 days on each tick (accommodates weekend
// settlement drift + broker processing lag). Rescan-from-scratch is
// a separate manual button (posts to /activities-rescan) that fetches
// 90 days.

import QuestradeIntegration from "../models/QuestradeIntegration.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { fetchAccounts, fetchActivities } from "./questradeClient.js";
import { makeReconcileKey } from "./stocksCibcParser.js";
import { planReconciliation } from "./stocksTradeReconciler.js";
import { applyReconciledTrade } from "./stocksTradeApplier.js";
import { backfillTradeToPortfolio } from "./stocksTradeApplier.js";

const DEFAULT_WINDOW_DAYS = 3;
const RESCAN_WINDOW_DAYS = 90;

// Questrade activity → normalized alert shape used by both pollers.
// Only interested in fill events (Trade activities where quantity is
// non-zero). Skip dividends, interest, fees, journal entries, etc.
function activityToAlert(a) {
  if (!a || a.type !== "Trades") return null;
  const rawAction = String(a.action || "").toUpperCase(); // "Buy" / "Sell"
  const action = rawAction === "BUY" ? "BUY" : rawAction === "SELL" ? "SELL" : null;
  if (!action) return null;
  const qty = Math.abs(Number(a.quantity) || 0);
  if (!(qty > 0)) return null;
  const pricePerShare = Number(a.price) || 0;
  if (!(pricePerShare > 0)) return null;
  const ticker = String(a.symbol || "").toUpperCase().trim();
  if (!ticker) return null;
  return {
    action,
    ticker,
    qty,
    pricePerShare,
    currency: (a.currency || "").toUpperCase() || null, // "CAD" | "USD"
    occurredAt: a.tradeDate || a.transactionDate || a.settlementDate || null,
    questradeActivityId: `${ticker}|${a.tradeDate || a.transactionDate}|${action}|${qty}|${pricePerShare}`,
  };
}

// Poll one user's Questrade integration for new trade activities.
// Returns a summary matching the CIBC poller's { inserted, skipped,
// errors, details } shape so any UI banner code reused across the two
// works without special-casing.
export async function pollQuestradeMailboxLike(userEmail, { windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const integration = await QuestradeIntegration.findOne({ email: userEmail });
  if (!integration) return { skipped: "not-configured" };
  if (integration.enabled === false) return { skipped: "disabled" };
  if (integration.needsReconnect) return { skipped: "needs-reconnect" };
  const links = (integration.accountLinks || []).filter(l => l.enabled !== false);
  if (links.length === 0) return { skipped: "no-account-links" };
  let profile = await StocksPortfolio.findOne({ email: userEmail }).lean();
  if (!profile) return { skipped: "no-profile" };

  const inserted = [];
  const skipped = [];
  const errors = [];
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - windowDays * 86400000).toISOString();
  let highWaterTs = integration.lastActivityTs || null;

  for (const link of links) {
    let activities;
    try {
      activities = await fetchActivities(integration, link.questradeAccountNumber, { startTime, endTime });
    } catch (e) {
      errors.push({ account: link.questradeAccountNumber, error: e?.message || String(e) });
      continue;
    }
    // Sort ascending by trade date so a session that only processes N
    // events still advances the watermark to the newest of those N.
    activities.sort((a, b) => new Date(a.tradeDate || 0) - new Date(b.tradeDate || 0));

    for (const a of activities) {
      const alert = activityToAlert(a);
      if (!alert) { skipped.push({ account: link.questradeAccountNumber, reason: "not-a-trade-fill" }); continue; }
      // High-water skip — activities we already processed on a prior tick.
      if (integration.lastActivityTs && alert.occurredAt && alert.occurredAt <= integration.lastActivityTs) {
        skipped.push({ account: link.questradeAccountNumber, reason: "before-watermark", ts: alert.occurredAt });
        continue;
      }
      const occurredAt = alert.occurredAt ? new Date(alert.occurredAt) : new Date();

      const reconcileKey = makeReconcileKey({
        email: userEmail,
        source: "questrade-api",
        action: alert.action,
        ticker: alert.ticker,
        qty: alert.qty,
        pricePerShare: alert.pricePerShare,
        occurredAtIso: occurredAt.toISOString(),
      });
      const dupe = await StocksTradeJournal.exists({ email: userEmail, brokerReconcileKey: reconcileKey });
      if (dupe) {
        skipped.push({ account: link.questradeAccountNumber, reason: "duplicate-poller", ticker: alert.ticker });
        if (alert.occurredAt) highWaterTs = maxIso(highWaterTs, alert.occurredAt);
        continue;
      }

      // Fuzzy dedupe against pre-existing journal entries (manual /
      // CSV / prior CIBC-poller). Same rules as the CIBC path so a
      // user in the transition period (CIBC and Questrade both
      // active) doesn't double-book a trade.
      try {
        const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
        const occurredMs = occurredAt.getTime();
        const candidates = await StocksTradeJournal.find({
          email: userEmail,
          executedAt: { $gte: new Date(occurredMs - 3 * 86400000), $lte: new Date(occurredMs + 3 * 86400000) },
          "legs.side": alert.action,
          "legs.shares": alert.qty,
        }).lean();
        const fuzzy = candidates.find(t => (t.legs || []).some(leg =>
          leg.side === alert.action &&
          leg.shares === alert.qty &&
          baseOf(leg.ticker) === baseOf(alert.ticker) &&
          Number.isFinite(leg.pricePerShare) &&
          Math.abs(leg.pricePerShare - alert.pricePerShare) / alert.pricePerShare <= 0.005
        ));
        if (fuzzy) {
          try {
            await StocksTradeJournal.updateOne(
              { _id: fuzzy._id, brokerReconcileKey: { $exists: false } },
              { $set: {
                  brokerReconcileKey: reconcileKey,
                  brokerReconcileSource: "questrade-api-matched-existing",
                  brokerReconcileNotes: `Fuzzy-matched to pre-existing trade (${fuzzy.brokerReconcileSource || "manual/CSV/CIBC"}).`,
                } }
            );
          } catch { /* index conflict → another concurrent poll got here first, harmless */ }
          if (fuzzy.positionApplied !== true) {
            try { await backfillTradeToPortfolio(fuzzy); } catch { /* Review flow will catch it */ }
          }
          skipped.push({ account: link.questradeAccountNumber, reason: "matches-existing-trade", ticker: alert.ticker });
          if (alert.occurredAt) highWaterTs = maxIso(highWaterTs, alert.occurredAt);
          continue;
        }
      } catch (e) {
        console.warn(`[questrade-poller] fuzzy check failed:`, e?.message);
      }

      // Prefer the user-mapped account. If it's missing (rare — the
      // link should exist since we just used it to fetch activities),
      // fall back to planReconciliation's usual heuristic.
      const mappedAcct = (profile.accounts || []).find(x => String(x.id) === String(link.curriculateAccountId));
      const plan = mappedAcct ? {
        account: { id: mappedAcct.id, name: mappedAcct.name },
        accountReason: `Questrade account ${link.questradeAccountNumber} → ${mappedAcct.name} (user-mapped)`,
        linked: null, // filled in below
        status: "auto",
        reviewReasons: [],
        occurredAt,
      } : await planReconciliation({ email: userEmail, profile, alert, occurredAt });

      // If we forged the plan, still resolve rec-linking via the shared
      // path (planReconciliation's tail does this; skip when we already
      // called it above).
      if (mappedAcct) {
        const full = await planReconciliation({ email: userEmail, profile, alert, occurredAt }).catch(() => null);
        if (full?.linked) plan.linked = full.linked;
      }

      const currency = alert.currency || (mappedAcct?.defaultCurrency) || "USD";
      const leg = {
        side: alert.action, ticker: alert.ticker, shares: alert.qty,
        pricePerShare: alert.pricePerShare, currency,
        grossValue: alert.qty * alert.pricePerShare,
      };
      const notesLine = `Auto-reconciled from Questrade activity · ${plan.status}${plan.reviewReasons?.length ? " · " + plan.reviewReasons.join("; ") : ""}`;
      const reconcileNotes = [plan.accountReason, plan.linked ? `linked ${plan.linked.kind} (${plan.linked.reason})` : "no linked rec"].filter(Boolean).join(" · ");

      if (plan.status === "auto" && plan.account?.id) {
        try {
          const { trade } = await applyReconciledTrade({
            email: userEmail,
            legs: [leg],
            accountId: plan.account.id,
            executedAt: occurredAt,
            notes: notesLine,
            linkedAdviceRecId: plan.linked?.kind === "advice" ? plan.linked.rec._id : null,
            linkedDailyPickId: plan.linked?.kind === "daily-pick" ? plan.linked.rec._id : null,
            brokerReconcileKey: reconcileKey,
            brokerReconcileSource: "questrade-api",
            brokerReconcileStatus: "auto",
            brokerReconcileNotes: reconcileNotes,
          });
          profile = await StocksPortfolio.findOne({ email: userEmail }).lean();
          inserted.push({ tradeId: String(trade._id), status: "auto", ticker: alert.ticker, action: alert.action, account: mappedAcct?.name });
        } catch (applyErr) {
          const fallbackDoc = await StocksTradeJournal.create({
            email: userEmail, executedAt: occurredAt,
            account: plan.account?.id || "", accountName: plan.account?.name || "",
            legs: [leg], netCashCad: 0, fxUsdCadAtTrade: profile.fxUsdCad || 1.37,
            notes: `${notesLine} · applier-failed: ${applyErr.message}`,
            brokerReconcileKey: reconcileKey,
            brokerReconcileSource: "questrade-api",
            brokerReconcileStatus: "needs-review",
            brokerReconcileNotes: `${reconcileNotes} · applier-failed: ${applyErr.message}`,
          });
          inserted.push({ tradeId: String(fallbackDoc._id), status: "needs-review-applier-failed", ticker: alert.ticker });
        }
      } else {
        const fx = profile.fxUsdCad || 1.37;
        const netCadSign = alert.action === "SELL" ? +1 : -1;
        const gross = alert.qty * alert.pricePerShare;
        const netCashCad = netCadSign * (currency === "USD" ? gross * fx : gross);
        const doc = {
          email: userEmail, executedAt: occurredAt,
          account: plan.account?.id || "", accountName: plan.account?.name || "",
          legs: [leg], netCashCad, fxUsdCadAtTrade: fx, notes: notesLine,
          brokerReconcileKey: reconcileKey,
          brokerReconcileSource: "questrade-api",
          brokerReconcileStatus: plan.status,
          brokerReconcileNotes: reconcileNotes,
          ...(plan.linked?.kind === "advice" ? { linkedAdviceRecId: plan.linked.rec._id } : {}),
          ...(plan.linked?.kind === "daily-pick" ? { linkedDailyPickId: plan.linked.rec._id } : {}),
        };
        const created = await StocksTradeJournal.create(doc);
        inserted.push({ tradeId: String(created._id), status: plan.status, ticker: alert.ticker });
        if (plan.linked?.kind === "advice" && plan.linked.rec._id) {
          try {
            await StocksAdviceRec.updateOne(
              { _id: plan.linked.rec._id, exitLevelsFilledBy: { $exists: false } },
              { $set: { exitLevelsFilledBy: new Date() } }
            );
          } catch {}
        }
      }
      if (alert.occurredAt) highWaterTs = maxIso(highWaterTs, alert.occurredAt);
    }
  }

  integration.lastPolledAt = new Date();
  integration.lastPollSucceeded = errors.length === 0;
  integration.lastPollError = errors.length === 0 ? "" : errors.map(e => `${e.account}: ${e.error}`).join(" | ").slice(0, 500);
  integration.reconciledCount = (integration.reconciledCount || 0) + inserted.length;
  if (highWaterTs) integration.lastActivityTs = highWaterTs;
  try { await integration.save(); } catch {}

  return {
    inserted: inserted.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { inserted, skipped, errors },
  };
}

export async function rescanQuestradeActivities(userEmail) {
  const integration = await QuestradeIntegration.findOne({ email: userEmail });
  if (!integration) return { skipped: "not-configured" };
  integration.lastActivityTs = null;
  integration.lastPollError = "";
  await integration.save();
  return pollQuestradeMailboxLike(userEmail, { windowDays: RESCAN_WINDOW_DAYS });
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a) >= new Date(b) ? a : b;
}
