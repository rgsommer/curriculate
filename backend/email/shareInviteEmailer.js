import nodemailer from "nodemailer";

function boolEnv(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ── Resend (HTTP API) ────────────────────────────────────────────────
// Set RESEND_API_KEY in env to use Resend instead of SMTP.
// Much more reliable than SMTP from cloud hosts that throttle port 587/465.
// Free tier: 100 emails/day at resend.com

async function sendViaResend({ to, cc, subject, html, attachments, fromAddress, fromName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const payload = {
    from: `${fromName} <${fromAddress}>`,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (attachments?.length) {
    // Resend supports two extra fields per attachment:
    //   content_id  → references the attachment from HTML as src="cid:<content_id>"
    //   contentType → MIME type (for inline images, e.g. "image/jpeg")
    // Inline images shown in the body use content_id + are referenced via
    // cid:foo in the HTML. Outlook respects this (unlike data: URIs).
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content instanceof Buffer ? a.content.toString("base64") : a.content,
      ...(a.contentType ? { contentType: a.contentType } : {}),
      ...(a.content_id  ? { content_id:  a.content_id  } : {}),
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000), // 15s — HTTP is fast
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Resend API ${res.status}: ${body}`);
    err.code = "RESEND_ERROR";
    err.responseCode = res.status;
    throw err;
  }
  return res.json();
}

// ── SMTP (nodemailer) — fallback ─────────────────────────────────────

let cachedTransporter = null;
let cachedFromAddress = null;
let cachedFromName = null;

function createTransport() {
  const host = required("SMTP_HOST");
  const port = parseInt(required("SMTP_PORT"), 10);
  const secure = boolEnv(process.env.SMTP_SECURE);

  const fromAddress = required("EMAIL_FROM_ADDRESS");
  const fromName = process.env.EMAIL_FROM_NAME || "Curriculate";

  const pass = required("SMTP_PASS");
  const user = fromAddress;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

  return { transporter, fromAddress, fromName };
}

export function buildTransport() {
  if (!cachedTransporter) {
    const built = createTransport();
    cachedTransporter = built.transporter;
    cachedFromAddress = built.fromAddress;
    cachedFromName = built.fromName;
  }
  return { transporter: cachedTransporter, fromAddress: cachedFromAddress, fromName: cachedFromName };
}

function resetTransport() {
  try { cachedTransporter?.close?.(); } catch { /* ignore */ }
  cachedTransporter = null;
}

// ── Public API ───────────────────────────────────────────────────────

export async function sendSystemEmail({ to, cc, subject, html, attachments }) {
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "noreply@curriculate.net";
  const fromName = process.env.EMAIL_FROM_NAME || "Curriculate";

  // Prefer Resend (HTTP) if configured — much faster and more reliable
  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ to, cc, subject, html, attachments, fromAddress, fromName });
  }

  // Fall back to SMTP with pooled transport + dead-socket recovery
  const { transporter } = buildTransport();
  try {
    return await transporter.sendMail({
      from: `${fromName} <${fromAddress}>`,
      to,
      cc: cc || undefined,
      subject,
      html,
      attachments: attachments || undefined,
    });
  } catch (err) {
    const code = err?.code;
    if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "ECONNRESET" || code === "EPIPE") {
      resetTransport();
    }
    throw err;
  }
}
