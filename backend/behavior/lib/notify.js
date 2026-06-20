// backend/behavior/lib/notify.js
//
// Delivery orchestration (brief §4, §7). Given a queued BehaviorNotice, send it
// on every enabled channel to every recipient, with Edsby→email failover, then
// record the per-channel outcome on the notice and write an audit entry. The
// rest of the app never talks to a provider directly — it goes through here.

import cron from "node-cron";
import BehaviorNotice from "../models/BehaviorNotice.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import BehaviorIncident from "../models/BehaviorIncident.js";
import { getEvidenceBytes, signEvidenceKey } from "./evidenceStore.js";
import BehaviorConfig from "../models/BehaviorConfig.js";
import BehaviorAuditLog from "../models/BehaviorAuditLog.js";
import BehaviorTeacher from "../models/BehaviorTeacher.js";
import { EmailProvider } from "./providers/EmailProvider.js";
import { emailShell, noteToHtml } from "./emailTemplate.js";
import { EdsbyProvider } from "./providers/EdsbyProvider.js";
import { decrypt, encrypt } from "./secretBox.js";

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
export async function sendWithFailover({ recipient, channels, subject, body, html, providers, allowEmailFailover = true, attachments, evidenceNote }) {
  const results = [];
  // Email carries evidence as file attachments; Edsby (text only) carries it as
  // a short links line appended to the message body.
  const edsbyBody = evidenceNote ? `${body}\n\n${evidenceNote}` : body;
  for (const ch of channels) {
    const provider = providers[ch];
    if (!provider) {
      results.push({ channel: ch, ok: false, error: "no provider configured", at: new Date() });
      continue;
    }
    const r = ch === "email"
      ? await provider.send({ recipient, subject, body, html, attachments })
      : await provider.send({ recipient, subject, body: edsbyBody, html });
    results.push({ channel: ch, ok: !!r.ok, error: r.error || "", at: new Date() });

    // Edsby failover: only when edsby failed, email wasn't already requested, we
    // have an email address — and the division has opted into emailing families.
    // Without that opt-in we must NOT silently email a parent (the whole point of
    // an Edsby-only school), so the notice is just recorded as failed instead.
    if (ch === "edsby" && !r.ok && allowEmailFailover && !channels.includes("email") && recipient.email && providers.email) {
      const fb = await providers.email.send({ recipient, subject, body, html, attachments });
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
export async function dispatchNotice(noticeId, { providers, force = false } = {}) {
  const notice = await BehaviorNotice.findById(noticeId);
  if (!notice) return { ok: false, error: "notice not found" };
  if (notice.status === "cancelled") return { ok: false, error: "cancelled" };
  if (notice.status === "sent") return { ok: true, alreadySent: true };

  // Editing a queued note pushes its cancelUntil out (the teacher is still
  // working on it). The eager per-notice timer must honour that, or it would
  // send the pre-edit wording. A manual "Send now" passes force to send at once.
  // The minute-by-minute sweeper only enqueues notices whose window has already
  // passed, so it never trips this. (1s grace absorbs timer jitter.)
  if (!force && notice.autoDispatch && notice.cancelUntil && notice.cancelUntil.getTime() - Date.now() > 1000) {
    const ms = notice.cancelUntil.getTime() - Date.now();
    setTimeout(() => {
      dispatchNotice(noticeId, { providers }).catch((err) =>
        console.error("[behavior/notify] deferred dispatch failed:", err?.message || err)
      );
    }, ms).unref?.();
    return { ok: true, deferred: true };
  }

  const student = await BehaviorStudent.findById(notice.studentId).lean();

  // Build providers with the school's Edsby connection (decrypted in memory).
  // The student's Edsby nid is the Panorama Referer for their parents' broadcasts.
  let prov = providers;
  if (!prov) {
    const config = await BehaviorConfig.findOne({ schoolId: notice.schoolId }).lean();
    const e = config?.edsby;

    // Per-teacher Edsby identity: post AS the teacher who sent the notice when
    // they've entered their own nid + session cookie; otherwise fall back to the
    // school's shared connection. jver/cver/baseUrl/zoomId stay school-level.
    let sender = null;
    if (notice.sentByTeacherId) {
      sender = await BehaviorTeacher.findById(notice.sentByTeacherId)
        .select("edsbyUserNid edsbyCookieEnc edsbyFormkeyEnc")
        .lean();
    }
    const useTeacher = !!(sender?.edsbyUserNid && sender?.edsbyCookieEnc);

    const edsby = e?.enabled
      ? {
          baseUrl: e.baseUrl,
          cookie: useTeacher ? decrypt(sender.edsbyCookieEnc) : decrypt(e.cookieEnc),
          formkey: useTeacher
            ? (sender.edsbyFormkeyEnc ? decrypt(sender.edsbyFormkeyEnc) : decrypt(e.formkeyEnc))
            : decrypt(e.formkeyEnc),
          jver: e.jver,
          cver: e.cver,
          userNid: useTeacher ? sender.edsbyUserNid : e.userNid,
          studentNid: student?.edsbyStudentId || "",
        }
      : {};
    prov = getDefaultProviders(edsby);

    // Refresh the (short-lived) formkey from the active session's cookie right
    // before sending, so Edsby doesn't reject the broadcast and fall over to
    // email just because the formkey went stale. Save it back to whichever
    // record supplied the session (the teacher's, or the school's).
    if (e?.enabled && edsby.cookie && notice.channels?.includes("edsby")) {
      try {
        const r = await prov.edsby.testConnection(e.zoomId);
        if (r?.ok && r.formkey) {
          prov.edsby.formkey = r.formkey;
          if (useTeacher) {
            await BehaviorTeacher.updateOne({ _id: notice.sentByTeacherId }, { $set: { edsbyFormkeyEnc: encrypt(r.formkey) } });
          } else {
            await BehaviorConfig.updateOne({ schoolId: notice.schoolId }, { $set: { "edsby.formkeyEnc": encrypt(r.formkey) } });
          }
        }
      } catch {
        /* fall through with the stored formkey; failover still protects us */
      }
    }
  }
  const studentName = student?.preferredName || student?.firstName || "your child";
  const positive = notice.reason === "positive";
  const subject = positive ? `Good news about ${studentName} 🎉` : `Behaviour notice — ${studentName}`;

  // Branded HTML version of the note (Edsby still uses the plain text body).
  const brand = await BehaviorConfig.findOne({ schoolId: notice.schoolId }).select("branding channels").lean();
  const schoolName = brand?.branding?.schoolName || "";
  // Only fall over to a parent's email if the division has opted into emailing
  // families; otherwise an Edsby failure must NOT become a surprise parent email.
  const allowEmailFailover = !!brand?.channels?.emailToParents;
  // Optional photo/video evidence — only when the teacher chose to send it with
  // this notice. Email gets the files as attachments; Edsby (text only) gets a
  // short links line. Gathered from the incidents that triggered the notice.
  // Wrapped so a storage hiccup never blocks the note itself.
  let attachments;
  let evidenceNote;
  let evidenceHtml = "";
  if (notice.includeEvidence) {
    try {
      const incs = await BehaviorIncident.find({ _id: { $in: notice.triggeringIncidentIds || [] } }).select("attachments").lean();
      const items = incs.flatMap((i) => i.attachments || []);
      if (items.length) {
        attachments = [];
        const links = [];
        for (let n = 0; n < items.length; n++) {
          const a = items[n];
          const bytes = await getEvidenceBytes(a.key);
          const ext = (a.key.split(".").pop() || (a.kind === "video" ? "mp4" : "jpg")).slice(0, 5);
          const filename = `${a.kind}-${n + 1}.${ext}`;
          if (bytes) attachments.push({ filename, content: bytes.buffer });
          const url = await signEvidenceKey(a.key, 7 * 24 * 60 * 60); // 7-day link for Edsby
          if (url) links.push(url);
        }
        if (!attachments.length) attachments = undefined;
        if (links.length) {
          evidenceNote = `Photo/video evidence (link${links.length > 1 ? "s" : ""} valid 7 days):\n${links.join("\n")}`;
          evidenceHtml = `<p style="margin:12px 0 0;font-size:13px;color:#475569"><strong>Evidence attached</strong> (${attachments?.length || links.length} file${(attachments?.length || links.length) > 1 ? "s" : ""}).</p>`;
        }
      }
    } catch (err) {
      console.warn("[behavior/notify] evidence attach failed:", err?.message || err);
    }
  }

  const html = emailShell({
    title: positive ? "A note of good news" : "A note from school",
    schoolName,
    preheader: positive ? `Some good news about ${studentName}.` : `A behaviour notice about ${studentName}.`,
    accent: positive ? "#16a34a" : "#0f172a",
    contentHtml: noteToHtml(notice.renderedText) + evidenceHtml,
  });

  const allDeliveries = [];
  for (const recipient of notice.recipients) {
    const deliveries = await sendWithFailover({
      recipient,
      channels: notice.channels,
      subject,
      body: notice.renderedText,
      html,
      providers: prov,
      allowEmailFailover,
      attachments,
      evidenceNote,
    });
    allDeliveries.push(...deliveries.map((d) => ({ ...d, recipient: recipient.email || recipient.edsbyParentId })));
  }

  const anyOk = allDeliveries.some((d) => d.ok);
  notice.deliveries = allDeliveries;
  notice.status = anyOk ? "sent" : "failed";
  notice.sentAt = anyOk ? new Date() : null;
  await notice.save();

  // Consume the strikes this DISCIPLINARY notice covered — but only now that it
  // has actually gone home. Marking the contributing incidents counted (which
  // zeroes the student's active strike total), advancing the notice counter, and
  // starting a fresh threshold window all happen here, NOT at queue time, so a
  // notice that is edited, deferred, or cancelled never resets a student early.
  // Gated on the incidents still being uncounted, which makes it: (a) idempotent
  // — a re-dispatch finds them already counted and does nothing; and (b) safe for
  // notices created under the old "reset at queue" model — their incidents are
  // already counted, so this skips and never double-increments the counter.
  if (anyOk && notice.reason !== "positive") {
    const ids = notice.triggeringIncidentIds || [];
    const uncounted = ids.length
      ? await BehaviorIncident.countDocuments({ _id: { $in: ids }, countedInNoticeId: null })
      : 0;
    if (uncounted > 0) {
      await BehaviorIncident.updateMany(
        { _id: { $in: ids }, countedInNoticeId: null },
        { $set: { countedInNoticeId: notice._id } }
      );
      const upd = { $inc: { noticesHomeCount: 1 }, $set: { lastNoticeAt: new Date() } };
      if (notice.reason === "threshold") upd.$set.thresholdResetAt = new Date();
      await BehaviorStudent.updateOne({ _id: notice.studentId }, upd);
    }
  }

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

/**
 * Reliability net: the per-notice setTimeout above is lost if the server
 * restarts (Render redeploys) before it fires, leaving auto notices stuck in
 * "queued". This sweep dispatches any auto notice whose cancellable window has
 * passed. dispatchNotice is idempotent, so it's safe to run alongside the timer.
 */
export async function sweepQueuedNotices() {
  const due = await BehaviorNotice.find({
    status: "queued",
    autoDispatch: true,
    cancelUntil: { $lte: new Date() },
  })
    .select("_id")
    .lean();
  for (const n of due) {
    await dispatchNotice(n._id).catch((err) => console.warn("[behavior/sweep] dispatch failed:", err?.message || err));
  }
  return due.length;
}

/** Register the every-minute queued-notice sweeper (call once at startup). */
export function startNoticeSweeper() {
  cron.schedule("* * * * *", () => {
    sweepQueuedNotices().catch((err) => console.error("[behavior/sweep] tick failed:", err?.message || err));
  });
  console.log("[behavior] notice sweeper started");
}
