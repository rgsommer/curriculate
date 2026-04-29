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

export function buildTransport() {
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
    connectionTimeout: 10000, // 10s to establish connection
    greetingTimeout: 10000,   // 10s for SMTP greeting
    socketTimeout: 30000,     // 30s for socket inactivity
  });

  return { transporter, fromAddress, fromName };
}

export async function sendSystemEmail({ to, cc, subject, html, attachments }) {
  const { transporter, fromAddress, fromName } = buildTransport();

  return transporter.sendMail({
    from: `${fromName} <${fromAddress}>`,
    to,
    cc: cc || undefined,
    subject,
    html,
    attachments: attachments || undefined,
  });
}
