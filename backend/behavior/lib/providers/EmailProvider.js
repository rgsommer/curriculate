// backend/behavior/lib/providers/EmailProvider.js
//
// Email implementation of NotificationProvider (brief §4). Reuses the existing
// nodemailer transport (backend/email/mailer.js). This is the day-one channel
// and also the failover target when an Edsby post fails.

import { NotificationProvider } from "./NotificationProvider.js";
import { sendEmail } from "../sendEmail.js";

export class EmailProvider extends NotificationProvider {
  get key() {
    return "email";
  }

  async send({ recipient, subject, body }) {
    const to = (recipient?.email || "").trim();
    if (!to) {
      return { ok: false, error: "recipient has no email address", channel: this.key };
    }
    try {
      const from = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      await sendEmail({
        from,
        to,
        subject,
        text: body,
        // Preserve line breaks in a minimal HTML body without trusting the
        // AI/template output as markup.
        html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;white-space:pre-wrap;line-height:1.5">${escapeHtml(
          body
        )}</div>`,
      });
      return { ok: true, channel: this.key };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), channel: this.key };
    }
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default EmailProvider;
