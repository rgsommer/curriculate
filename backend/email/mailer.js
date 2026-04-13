// backend/email/mailer.js
import nodemailer from "nodemailer";

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 15_000,   // 15s to establish TCP connection
  greetingTimeout: 15_000,     // 15s for SMTP greeting
  socketTimeout: 30_000,       // 30s inactivity timeout on socket
});
