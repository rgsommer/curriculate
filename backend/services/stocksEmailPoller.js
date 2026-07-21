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

  const profile = await StocksPortfolio.findOne({ email: userEmail }).lean();
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
          const fx = profile.fxUsdCad || 1.37;
          const netCadSign = alert.action === "SELL" ? +1 : -1;
          const netCashCad = netCadSign * (currency === "USD" ? gross * fx : gross);

          const doc = {
            email: userEmail,
            executedAt: occurredAt,
            account: plan.account?.id || "",
            accountName: plan.account?.name || "",
            legs: [{
              side: alert.action,
              ticker: alert.ticker,
              shares: alert.qty,
              pricePerShare: alert.pricePerShare,
              currency,
              grossValue: gross,
            }],
            netCashCad,
            fxUsdCadAtTrade: fx,
            notes: `Auto-reconciled from CIBC alert · ${plan.status}${plan.reviewReasons?.length ? " · " + plan.reviewReasons.join("; ") : ""}`,
            brokerReconcileKey: reconcileKey,
            brokerReconcileSource: "cibc-email",
            brokerReconcileStatus: plan.status,
            brokerReconcileNotes: [plan.accountReason, plan.linked ? `linked ${plan.linked.kind} (${plan.linked.reason})` : "no linked rec"].filter(Boolean).join(" · "),
            ...(plan.linked?.kind === "advice" ? { linkedAdviceRecId: plan.linked.rec._id } : {}),
            ...(plan.linked?.kind === "daily-pick" ? { linkedDailyPickId: plan.linked.rec._id } : {}),
          };
          const created = await StocksTradeJournal.create(doc);
          inserted.push({ uid, tradeId: String(created._id), status: plan.status, ticker: alert.ticker, action: alert.action });

          // Best-effort: mark the linked AdviceRec's exit-filled marker
          // so the "which recs are still open" query stops surfacing it.
          if (plan.linked?.kind === "advice" && plan.linked.rec._id) {
            try {
              await StocksAdviceRec.updateOne(
                { _id: plan.linked.rec._id, exitLevelsFilledBy: { $exists: false } },
                { $set: { exitLevelsFilledBy: new Date() } }
              );
            } catch { /* non-fatal */ }
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
