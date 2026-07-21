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

// Filters that predate the 2026-07-22 fragility fix. Anyone whose
// stored filter EXACTLY equals one of these gets silently upgraded
// to the new default on next poll — a customized filter (e.g. one
// that adds a label restriction) is left alone.
const LEGACY_FILTER_DEFAULTS = new Set([
  "from:alerts@cibc.com is:unread",
]);
const CURRENT_FILTER_DEFAULT = "from:alerts@cibc.com newer_than:30d";

// Poll one user's mailbox and reconcile any new alerts. Returns a
// summary; also stamps the integration doc with heartbeat + counters.
export async function pollUserMailbox(userEmail) {
  const integration = await StocksEmailIntegration.findOne({ email: userEmail });
  if (!integration) return { skipped: "not-configured" };
  if (integration.enabled === false) return { skipped: "disabled" };

  // Silently upgrade a legacy default filter. The old "is:unread"
  // filter dropped alerts the user read on their phone before the
  // poller ran; UID high-water + reconcile-key dedup already prevent
  // duplicates, so the read/unread state was redundant AND fragile.
  if (LEGACY_FILTER_DEFAULTS.has(integration.imapSearchQuery)) {
    console.log(`[stocks-email-poller] upgrading ${userEmail} filter from "${integration.imapSearchQuery}" → "${CURRENT_FILTER_DEFAULT}"`);
    integration.imapSearchQuery = CURRENT_FILTER_DEFAULT;
    await integration.save();
  }

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
          const subj = msg?.envelope?.subject || "(no subject)";
          const from = msg?.envelope?.from?.[0]?.address || "(unknown)";
          if (!msg?.source) { skipped.push({ uid, reason: "no-source", subject: subj, from }); highWater = Math.max(highWater, uid); continue; }
          const parsed = await simpleParser(msg.source);
          const bodyText = parsed.text || (parsed.html || "").replace(/<[^>]+>/g, " ");
          const alert = parseCibcAlert(bodyText, subj);
          if (!alert) { skipped.push({ uid, reason: "not-a-cibc-alert", subject: subj, from, bodyPreview: bodyText.slice(0, 200).replace(/\s+/g, " ") }); highWater = Math.max(highWater, uid); continue; }
          // Subject-only parse returns currency=null; infer from held
          // position (a ticker held with ccy=CAD/USD is the ground truth).
          // Falls back to USD when the ticker isn't held anywhere.
          if (alert.currency == null) {
            const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
            const held = (profile.positions || []).find(p => baseOf(p.ticker) === baseOf(alert.ticker));
            alert.currency = held?.ccy || "USD";
          }
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
          if (dupe) { skipped.push({ uid, reason: "duplicate-poller", key: reconcileKey, subject: subj }); highWater = Math.max(highWater, uid); await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true }).catch(() => {}); continue; }

          // Fuzzy-match against ANY existing trade in the journal (manual
          // Record Trade, CSV import, previous poll under an old key
          // format). Same trade recorded through any channel must not
          // double-insert. Match criteria:
          //   • executedAt within ±3 days (broker timing vs user typing)
          //   • at least one leg whose base ticker == alert base ticker
          //   • same side (BUY/SELL)
          //   • same shares (exact)
          //   • price within ±0.5% (accommodates FX rounding differences
          //     if the user typed the CAD equivalent instead of the
          //     native quote)
          try {
            const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
            const alertBase = baseOf(alert.ticker);
            const occurredMs = new Date(occurredAt).getTime();
            const candidates = await StocksTradeJournal.find({
              email: userEmail,
              executedAt: {
                $gte: new Date(occurredMs - 3 * 86400000),
                $lte: new Date(occurredMs + 3 * 86400000),
              },
              "legs.side": alert.action,
              "legs.shares": alert.qty,
            }).lean();
            const fuzzyMatch = candidates.find(t =>
              (t.legs || []).some(leg =>
                leg.side === alert.action &&
                leg.shares === alert.qty &&
                baseOf(leg.ticker) === alertBase &&
                Number.isFinite(leg.pricePerShare) &&
                Math.abs(leg.pricePerShare - alert.pricePerShare) / alert.pricePerShare <= 0.005
              )
            );
            if (fuzzyMatch) {
              // Stamp the reconcile key on the pre-existing trade doc so
              // future polls skip it via the fast unique-index path
              // instead of re-scanning by fuzzy match. Best-effort — an
              // index conflict just means another concurrent poll got
              // there first.
              try {
                await StocksTradeJournal.updateOne(
                  { _id: fuzzyMatch._id, brokerReconcileKey: { $exists: false } },
                  { $set: {
                      brokerReconcileKey: reconcileKey,
                      brokerReconcileSource: "cibc-email-matched-existing",
                      brokerReconcileNotes: `Fuzzy-matched to pre-existing trade (${fuzzyMatch.brokerReconcileSource || "manual/CSV"}) at poll time ${new Date().toISOString()}.`,
                    } }
                );
              } catch { /* non-fatal — future polls will still match via fuzzy path */ }
              skipped.push({ uid, reason: "matches-existing-trade", matchedTradeId: String(fuzzyMatch._id), subject: subj });
              highWater = Math.max(highWater, uid);
              await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true }).catch(() => {});
              continue;
            }
          } catch (e) {
            console.warn("[stocks-email-poller] fuzzy dedup check failed:", e?.message);
            // fall through — if the check errors, prefer to insert than to skip
          }

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
