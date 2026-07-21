// backend/services/stocksEmailPoller.js
//
// End-to-end IMAP → parse → reconcile → journal for one user. Called
// by the cron on each tick and by the /email-integration/test endpoint
// on demand.
//
// Design:
//   • Reuses the encrypted app password via decryptSecret.
//   • Uses Gmail's search extension via imapflow's x_gm_raw so the
//     Settings-configured query ("from:alerts@cibc.com is:unread") works
//     as-typed instead of forcing IMAP's crude SEARCH grammar.
//   • Marks messages Seen only AFTER a successful DB insert or an
//     explicit "duplicate / needs-review" outcome, so a mid-run crash
//     leaves un-Seen messages for the next tick to retry.
//   • Never deletes messages. The user can still archive/read manually.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import StocksEmailIntegration from "../models/StocksEmailIntegration.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import { decryptSecret } from "./stocksEncryption.js";
import { parseCibcAlert, makeReconcileKey } from "./stocksCibcParser.js";
import { planReconciliation } from "./stocksTradeReconciler.js";
import { applyReconciledTrade } from "./stocksTradeApplier.js";

const MAX_MESSAGES_PER_TICK = 25;

// Connect + login, then run `fn(client)`. Always closes the connection.
async function withImap(integration, fn) {
  const password = decryptSecret(integration.envelopePassword);
  const client = new ImapFlow({
    host: integration.imapHost || "imap.gmail.com",
    port: integration.imapPort || 993,
    secure: integration.imapUseTls !== false,
    auth: { user: integration.mailboxAddress, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try { return await fn(client); }
    finally { lock.release(); }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Live IMAP round-trip: connect, verify mailbox, count matching messages.
// Used by the Test connection button in Settings so the user gets a
// definite yes/no signal without waiting for the next poll.
export async function testConnection(email) {
  const integration = await StocksEmailIntegration.findOne({ email }).lean();
  if (!integration) return { ok: false, error: "No integration configured" };
  try {
    const info = await withImap(integration, async (client) => {
      const mailbox = client.mailbox;
      const query = integration.imapSearchQuery || "from:alerts@cibc.com is:unread";
      const uids = await client.search({ gmailRaw: query }, { uid: true });
      return {
        mailboxPath: mailbox?.path || "INBOX",
        exists: mailbox?.exists || 0,
        matchingCount: (uids || []).length,
        query,
      };
    });
    return { ok: true, ...info };
  } catch (e) {
    return { ok: false, error: e?.responseText || e?.message || "IMAP error" };
  }
}

// Poll one user's mailbox and reconcile any new alerts. Returns a
// summary; also stamps the integration doc with heartbeat + counters.
export async function pollUserMailbox(userEmail) {
  const integration = await StocksEmailIntegration.findOne({ email: userEmail });
  if (!integration) return { skipped: "not-configured" };
  if (integration.enabled === false) return { skipped: "disabled" };

  let profile = await StocksPortfolio.findOne({ email: userEmail }).lean();
  if (!profile) return { skipped: "no-profile" };

  const query = integration.imapSearchQuery || "from:alerts@cibc.com is:unread";
  const inserted = [];
  const skipped = [];
  const errors = [];

  try {
    await withImap(integration, async (client) => {
      const uids = await client.search({ gmailRaw: query }, { uid: true });
      const fresh = (uids || [])
        .filter((uid) => !integration.lastProcessedUid || uid > integration.lastProcessedUid)
        .sort((a, b) => a - b)
        .slice(0, MAX_MESSAGES_PER_TICK);

      if (fresh.length === 0) return;

      let highWater = integration.lastProcessedUid || 0;
      for (const uid of fresh) {
        try {
          const msg = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });
          if (!msg?.source) { skipped.push({ uid, reason: "no-source" }); highWater = Math.max(highWater, uid); continue; }
          const parsed = await simpleParser(msg.source);
          const bodyText = parsed.text || (parsed.html || "").replace(/<[^>]+>/g, " ");
          const alert = parseCibcAlert(bodyText);
          if (!alert) { skipped.push({ uid, reason: "not-a-cibc-alert" }); highWater = Math.max(highWater, uid); continue; }
          const occurredAt = parsed.date || msg.envelope?.date || new Date();

          const reconcileKey = makeReconcileKey({
            email: userEmail,
            source: "cibc-email",
            action: alert.action,
            ticker: alert.ticker,
            qty: alert.qty,
            pricePerShare: alert.pricePerShare,
            occurredAtIso: new Date(occurredAt).toISOString(),
          });
          const dupe = await StocksTradeJournal.exists({ email: userEmail, brokerReconcileKey: reconcileKey });
          if (dupe) { skipped.push({ uid, reason: "duplicate", key: reconcileKey }); highWater = Math.max(highWater, uid); await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true }).catch(() => {}); continue; }

          const plan = await planReconciliation({ email: userEmail, profile, alert, occurredAt });
          const currency = alert.currency;
          const gross = alert.qty * alert.pricePerShare;

          const leg = {
            side: alert.action,
            ticker: alert.ticker,
            shares: alert.qty,
            pricePerShare: alert.pricePerShare,
            currency,
            grossValue: gross,
          };
          const notesLine = `Auto-reconciled from CIBC alert · ${plan.status}${plan.reviewReasons?.length ? " · " + plan.reviewReasons.join("; ") : ""}`;
          const reconcileNotes = [plan.accountReason, plan.linked ? `linked ${plan.linked.kind} (${plan.linked.reason})` : "no linked rec"].filter(Boolean).join(" · ");

          // Auto plans → apply through the shared trade-applier so
          // positions + cash + daily-pick "ENTERED" all update, matching
          // the manual "Record trade" flow.
          //
          // Needs-review plans → journal only (no position/cash mutation).
          // The Dashboard shouldn't move on an ambiguous alert; the trader
          // resolves account/rec linkage manually via the Trades tab first.
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
                brokerReconcileSource: "cibc-email",
                brokerReconcileStatus: "auto",
                brokerReconcileNotes: reconcileNotes,
              });
              // Refresh cached profile so subsequent alerts in this
              // poll see the updated positions/cash. Without this, two
              // SELLs of the same ticker in one poll would both plan
              // against pre-first-SELL holdings and mis-attribute the
              // second one.
              profile = await StocksPortfolio.findOne({ email: userEmail }).lean();
              inserted.push({ uid, tradeId: String(trade._id), status: "auto", ticker: alert.ticker, action: alert.action });
            } catch (applyErr) {
              // Applier failed the position math (over-sell, unknown
              // account, etc). Downgrade to needs-review + journal only
              // so the trade is still visible, then keep going.
              const fallbackNotes = `${reconcileNotes} · applier-failed: ${applyErr.message}`;
              const fallbackDoc = await StocksTradeJournal.create({
                email: userEmail,
                executedAt: occurredAt,
                account: plan.account?.id || "",
                accountName: plan.account?.name || "",
                legs: [leg],
                netCashCad: 0,
                fxUsdCadAtTrade: profile.fxUsdCad || 1.37,
                notes: `${notesLine} · applier-failed: ${applyErr.message}`,
                brokerReconcileKey: reconcileKey,
                brokerReconcileSource: "cibc-email",
                brokerReconcileStatus: "needs-review",
                brokerReconcileNotes: fallbackNotes,
              });
              inserted.push({ uid, tradeId: String(fallbackDoc._id), status: "needs-review-applier-failed", ticker: alert.ticker, action: alert.action });
            }
          } else {
            // Needs-review: journal, but do NOT touch positions/cash.
            const fx = profile.fxUsdCad || 1.37;
            const netCadSign = alert.action === "SELL" ? +1 : -1;
            const netCashCad = netCadSign * (currency === "USD" ? gross * fx : gross);
            const doc = {
              email: userEmail,
              executedAt: occurredAt,
              account: plan.account?.id || "",
              accountName: plan.account?.name || "",
              legs: [leg],
              netCashCad,
              fxUsdCadAtTrade: fx,
              notes: notesLine,
              brokerReconcileKey: reconcileKey,
              brokerReconcileSource: "cibc-email",
              brokerReconcileStatus: plan.status,
              brokerReconcileNotes: reconcileNotes,
              ...(plan.linked?.kind === "advice" ? { linkedAdviceRecId: plan.linked.rec._id } : {}),
              ...(plan.linked?.kind === "daily-pick" ? { linkedDailyPickId: plan.linked.rec._id } : {}),
            };
            const created = await StocksTradeJournal.create(doc);
            inserted.push({ uid, tradeId: String(created._id), status: plan.status, ticker: alert.ticker, action: alert.action });

            if (plan.linked?.kind === "advice" && plan.linked.rec._id) {
              try {
                await StocksAdviceRec.updateOne(
                  { _id: plan.linked.rec._id, exitLevelsFilledBy: { $exists: false } },
                  { $set: { exitLevelsFilledBy: new Date() } }
                );
              } catch { /* non-fatal */ }
            }
          }

          await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true }).catch(() => {});
          highWater = Math.max(highWater, uid);
        } catch (perMsgErr) {
          errors.push({ uid, error: perMsgErr?.message || String(perMsgErr) });
          // DO NOT advance highWater on error — leave un-Seen so next tick retries.
        }
      }

      integration.lastProcessedUid = Math.max(integration.lastProcessedUid || 0, highWater);
    });

    integration.lastPolledAt = new Date();
    integration.lastPollSucceeded = errors.length === 0;
    integration.lastPollError = errors.length === 0 ? "" : errors.map(e => `uid ${e.uid}: ${e.error}`).join(" | ").slice(0, 500);
    integration.reconciledCount = (integration.reconciledCount || 0) + inserted.length;
    await integration.save();

    return { inserted: inserted.length, skipped: skipped.length, errors: errors.length, details: { inserted, skipped, errors } };
  } catch (fatal) {
    integration.lastPolledAt = new Date();
    integration.lastPollSucceeded = false;
    integration.lastPollError = (fatal?.message || String(fatal)).slice(0, 500);
    await integration.save().catch(() => {});
    return { fatal: fatal?.message || String(fatal) };
  }
}
