// backend/email/mailer.js
import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

if (!smtpHost || !smtpUser || !smtpPass) {
  console.warn("[mailer] ⚠️  SMTP not fully configured — emails will fail. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
}

export const mailer = nodemailer.createTransport({
  host: smtpHost,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
  connectionTimeout: 15_000,   // 15s to establish TCP connection
  greetingTimeout: 15_000,     // 15s for SMTP greeting
  socketTimeout: 30_000,       // 30s inactivity timeout on socket
});

// Verify SMTP connection on startup (non-blocking)
mailer.verify()
  .then(() => console.log("[mailer] ✅ SMTP connection verified"))
  .catch((err) => console.warn("[mailer] ⚠️  SMTP verification failed:", err.message, "— emails may not be delivered"));
