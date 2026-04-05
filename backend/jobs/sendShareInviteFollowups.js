import SharedTasksetLink from "../models/SharedTasksetLink.js";
import TaskSet from "../models/TaskSet.js";
import SystemEmailTemplate from "../models/SystemEmailTemplate.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function renderTemplate(html, vars) {
  let out = String(html || "");
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll(`{{${k}}}`, String(v ?? ""));
  }
  return out;
}

async function getTemplateOrDefault(key) {
  const t = await SystemEmailTemplate.findOne({ key }).lean();
  if (t && t.enabled) return t;

  // defaults (safe fallbacks)
  if (key === "share-followup-7") {
    return {
      key,
      enabled: true,
      followupDays: 7,
      subject: "Reminder: a Curriculate task set is waiting for you",
      html: DEFAULT_FOLLOWUP_7_HTML,
    };
  }
  if (key === "share-followup-30") {
    return {
      key,
      enabled: true,
      followupDays: 30,
      subject: "Final reminder: shared Curriculate task set",
      html: DEFAULT_FOLLOWUP_30_HTML,
    };
  }
  return null;
}

const DEFAULT_FOLLOWUP_7_HTML = `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
  <h2 style="margin:0 0 8px 0;">Reminder: a task set was shared with you</h2>
  <p style="margin:0 0 10px 0;">{{SENDER_NAME}} shared a ready-to-run task set with you on Curriculate.</p>

  <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin:12px 0;">
    <div style="font-weight:700;">Open and run the task set</div>
    <div style="margin-top:8px;">
      <a href="{{SHARE_URL}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">
        Open in Curriculate
      </a>
    </div>
    <div style="margin-top:10px;color:#475569;font-size:13px;">This link expires on {{EXPIRES_DATE}}.</div>
  </div>
</div>
`;

const DEFAULT_FOLLOWUP_30_HTML = `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
  <h2 style="margin:0 0 8px 0;">Final reminder</h2>
  <p style="margin:0 0 10px 0;">If you still need it, the shared task set link is below (if it hasn't expired).</p>

  <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin:12px 0;">
    <div style="font-weight:700;">Open and run the task set</div>
    <div style="margin-top:8px;">
      <a href="{{SHARE_URL}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">
        Open in Curriculate
      </a>
    </div>
    <div style="margin-top:10px;color:#475569;font-size:13px;">This link expires on {{EXPIRES_DATE}}.</div>
  </div>
</div>
`;

export async function runShareInviteFollowups({ teacherAppOrigin }) {
  const now = new Date();

  const links = await SharedTasksetLink.find({
    expiresAt: { $gt: now },
    revokedAt: { $exists: false },
    "invites.sentAt": { $exists: true },
  }).lean();

  let sentCount = 0;

  const t7 = await getTemplateOrDefault("share-followup-7");
  const t30 = await getTemplateOrDefault("share-followup-30");

  for (const link of links) {
    const taskset = await TaskSet.findById(link.tasksetId).lean().catch(() => null);
    const tasksetName = taskset?.name || taskset?.title || "a Curriculate task set";
    const shareUrl = `${teacherAppOrigin}/share/${link.token}`;

    for (const inv of link.invites || []) {
      if (!inv?.toEmail || !inv?.sentAt) continue;
      if (inv.firstUsedAt) continue; // ✅ stop followups after first run

      const ageDays = daysBetween(new Date(inv.sentAt), now);

      // 7-day follow-up
      if (t7?.enabled && ageDays >= (t7.followupDays ?? 7) && !inv.followup7SentAt) {
        const vars = {
          SENDER_NAME: inv.senderName || "A presenter",
          TASKSET_NAME: tasksetName,
          SHARE_URL: shareUrl,
          EXPIRES_DATE: link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : "",
        };

        await sendSystemEmail({
          to: inv.toEmail,
          cc: inv.ccEmail || undefined,
          subject: renderTemplate(t7.subject, vars),
          html: renderTemplate(t7.html, vars),
        });

        await SharedTasksetLink.updateOne(
          { _id: link._id, "invites.toEmail": inv.toEmail, "invites.sentAt": inv.sentAt },
          { $set: { "invites.$.followup7SentAt": now } }
        );

        sentCount += 1;
      }

      // 30-day follow-up
      if (t30?.enabled && ageDays >= (t30.followupDays ?? 30) && !inv.followup30SentAt) {
        const vars = {
          SENDER_NAME: inv.senderName || "A presenter",
          TASKSET_NAME: tasksetName,
          SHARE_URL: shareUrl,
          EXPIRES_DATE: link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : "",
        };

        await sendSystemEmail({
          to: inv.toEmail,
          cc: inv.ccEmail || undefined,
          subject: renderTemplate(t30.subject, vars),
          html: renderTemplate(t30.html, vars),
        });

        await SharedTasksetLink.updateOne(
          { _id: link._id, "invites.toEmail": inv.toEmail, "invites.sentAt": inv.sentAt },
          { $set: { "invites.$.followup30SentAt": now } }
        );

        sentCount += 1;
      }
    }
  }

  return { ok: true, sentCount };
}
