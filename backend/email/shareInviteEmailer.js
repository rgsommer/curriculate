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
  const user = fromAddress; // Google Workspace SMTP typically uses the mailbox address as user

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Pool connections so back-to-back sends (e.g. a batch email retry)
    // don't keep paying TCP+TLS handshake cost or hit Gmail's new-connection rate limit.
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

export async function sendSystemEmail({ to, cc, subject, html, attachments }) {
  const { transporter, fromAddress, fromName } = buildTransport();

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
    // On connection-class errors the pool may be holding a dead socket — drop it
    // so the next call gets a fresh connection instead of replaying the same fail.
    const code = err?.code;
    if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "ECONNRESET" || code === "EPIPE") {
      resetTransport();
    }
    throw err;
  }
}
