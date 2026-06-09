// backend/behavior/lib/sendEmail.js
//
// Unified email sender for the Behaviours app. Uses Resend over HTTPS when
// RESEND_API_KEY is set — important because many hosts (Render included on
// common plans) BLOCK outbound SMTP ports, so nodemailer/SMTP times out. Falls
// back to the existing SMTP transport when no Resend key is configured.
//
// The Resend `from` MUST be an address on a Resend-verified domain — set
// RESEND_FROM (e.g. "Behaviours <behaviours@yourverifieddomain>").

function fromString(from) {
  if (!from) {
    return (
      process.env.RESEND_FROM ||
      process.env.BEHAVIOR_FROM_EMAIL ||
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      ""
    );
  }
  if (typeof from === "object" && from.address) return `${from.name || "Behaviours"} <${from.address}>`;
  return String(from);
}

/**
 * Send an email. Shape mirrors nodemailer: { from, to, subject, text, html, replyTo }.
 * Throws on failure (callers catch + report).
 */
export async function sendEmail({ from, to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const { Resend } = await import("resend");
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM || fromString(from),
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
      replyTo: replyTo || undefined,
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return data;
  }
  const { mailer } = await import("../../email/mailer.js");
  return mailer.sendMail({ from, to, subject, text, html, replyTo });
}
