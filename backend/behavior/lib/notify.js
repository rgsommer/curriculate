// backend/behavior/lib/notify.js
//
// Delivery orchestration (brief §4, §7). Given a queued BehaviorNotice, send it
// on every enabled channel to every recipient, with Edsby→email failover, then
// record the per-channel outcome on the notice and write an audit entry. The
// rest of the app never talks to a provider directly — it goes through here.

import BehaviorNotice from "../models/BehaviorNotice.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import BehaviorConfig from "../models/BehaviorConfig.js";
import BehaviorAuditLog from "../models/BehaviorAuditLog.js";
import { EmailProvider } from "./providers/EmailProvider.js";
import { EdsbyProvider } from "./providers/EdsbyProvider.js";
import { decrypt } from "./secretBox.js";

export function getDefaultProviders(edsby = {}) {
  return { email: new EmailProvider(), edsby: new EdsbyProvider(edsby) };
}

/**
 * Deliver one notice to one recipient across the requested channels. If an
 * Edsby post fails and email isn't already in the channel set, fail over to
 * email for that recipient (brief §4.1). Providers are injectable for testing.
 *
 * @returns {Promise<Array>} delivery records { channel, ok, error, at, failover? }
 */
export async function sendWithFailover({ recipient, channels, subject, body, providers }) {
  const results = [];
  for (const ch of channels) {
    const provider = providers[ch];
    if (!provider) {
      results.push({ channel: ch, ok: false, error: "no provider configured", at: new Date() });
      continue;
    }
    const r = await provider.send({ recipient, subject, body });
    results.push({ channel: ch, ok: !!r.ok, error: r.error || "", at: new Date() });

    // Edsby failover: only when edsby failed, email wasn't already requested,
    // and we have an email address to fall back to.
    if (ch === "edsby" && !r.ok && !channels.includes("email") && recipient.email && providers.email) {
      const fb = await providers.email.send({ recipient, subject, body });
      results.push({
        channel: "email",
        ok: !!fb.ok,
        error: fb.ok ? "" : fb.error || "",
        at: new Date(),
        failover: true,
      });
    }
  }
  return results;
}

/**
 * Dispatch a queued notice: send to all recipients, persist outcomes, audit.
 * Skips if the notice was cancelled in its cancellable window.
 */
export async function dispatchNotice(noticeId, { providers } = {}) {
  const notice = await BehaviorNotice.findById(noticeId);
  if (!notice) return { ok: false, error: "notice not found" };
  if (notice.status === "cancelled") return { ok: false, error: "cancelled" };
  if (notice.status === "sent") return { ok: true, alreadySent: true };

  // Build providers with the school's Edsby connection (decrypted in memory).
  let prov = providers;
  if (!prov) {
    const config = await BehaviorConfig.findOne({ schoolId: notice.schoolId }).lean();
    const edsby = config?.edsby?.enabled
      ? { baseUrl: config.edsby.baseUrl, cookie: decrypt(config.edsby.cookieEnc) }
      : {};
    prov = getDefaultProviders(edsby);
  }

  const student = await BehaviorStudent.findById(notice.studentId).lean();
  const studentName = student?.preferredName || student?.firstName || "your child";
  const subject = `Behaviour notice — ${studentName}`;

  const allDeliveries = [];
  for (const recipient of notice.recipients) {
    const deliveries = await sendWithFailover({
      recipient,
      channels: notice.channels,
      subject,
      body: notice.renderedText,
      providers: prov,
    });
    allDeliveries.push(...deliveries.map((d) => ({ ...d, recipient: recipient.email || recipient.edsbyParentId })));
  }

  const anyOk = allDeliveries.some((d) => d.ok);
  notice.deliveries = allDeliveries;
  notice.status = anyOk ? "sent" : "failed";
  notice.sentAt = anyOk ? new Date() : null;
  await notice.save();

  await BehaviorAuditLog.create({
    schoolId: notice.schoolId,
    type: anyOk ? "notice.sent" : "notice.failed",
    studentId: notice.studentId,
    noticeId: notice._id,
    meta: {
      channels: notice.channels,
      ccVp: notice.ccVp,
      sequenceNo: notice.sequenceNo,
      aiUsed: notice.aiUsed,
      recipientCount: notice.recipients.length,
      deliveries: allDeliveries.map((d) => ({ channel: d.channel, ok: d.ok, failover: !!d.failover })),
    },
  });

  return { ok: anyOk, status: notice.status };
}

/**
 * Schedule dispatch after the cancellable window (brief §8 send model). With
 * cancelWindowSeconds = 0 it dispatches immediately. Uses an in-process timer;
 * a queued notice that is still "queued" at fire time is dispatched. (A durable
 * queue can replace this later without changing callers.)
 */
export function scheduleDispatch(noticeId, cancelWindowSeconds = 60, opts = {}) {
  const ms = Math.max(0, Number(cancelWindowSeconds) || 0) * 1000;
  if (ms === 0) return dispatchNotice(noticeId, opts);
  setTimeout(() => {
    dispatchNotice(noticeId, opts).catch((err) =>
      console.error("[behavior/notify] scheduled dispatch failed:", err?.message || err)
    );
  }, ms).unref?.();
  return Promise.resolve({ ok: true, scheduled: true, inSeconds: cancelWindowSeconds });
}
