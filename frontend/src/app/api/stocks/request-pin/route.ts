/**
 * POST /api/stocks/request-pin
 *
 * Generates a 5-digit verification PIN, emails it via Resend,
 * and returns a stateless HMAC-signed token containing the PIN hash + expiry.
 *
 * The client then submits the PIN + token back to /api/stocks/verify-pin.
 *
 * Required env vars:
 *   RESEND_API_KEY    — same key the rest of the app uses
 *   STOCKS_SECRET     — any long random string (HMAC signing). Falls back to
 *                       MEDICENTRE_SECRET if STOCKS_SECRET is not set.
 *   STOCKS_FROM       — optional From: line (default: "Stocks Advisor <noreply@curriculate.net>")
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

// ── tiny per-IP rate limit (5 / 10 min) ────────────────────────────
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function rateOk(ip: string) {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (e.count >= RATE_MAX) return false;
  e.count++;
  return true;
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getSecret(): string {
  const s = process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET;
  if (!s) throw new Error("STOCKS_SECRET (or MEDICENTRE_SECRET) not configured");
  return s;
}

function signToken(payload: object) {
  const secret = getSecret();
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function pinHash(pin: string, email: string) {
  return crypto
    .createHash("sha256")
    .update(pin + "|" + email.toLowerCase() + "|" + getSecret())
    .digest("hex");
}

export async function POST(req: Request) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
    }

    const ip = getClientIp(req);
    if (!rateOk(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a few minutes." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // 5-digit PIN
    const pin = String(Math.floor(10000 + Math.random() * 90000));

    // Stateless token: email + hash(PIN) + 10-minute expiry
    const exp = Math.floor(Date.now() / 1000) + 10 * 60;
    const token = signToken({ email, ph: pinHash(pin, email), exp });

    // Send by email
    const from = process.env.STOCKS_FROM || "Stocks Advisor <noreply@curriculate.net>";

    const send = await resend.emails.send({
      from,
      to: email,
      subject: `Your Stocks Advisor sign-in code: ${pin}`,
      text: `Your sign-in code is: ${pin}

Enter this 5-digit code at curriculate.net/stocks to sign in.
This code expires in 10 minutes.

If you didn't request this, you can ignore this message.`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f172a;max-width:520px;margin:24px auto;padding:24px;">
        <h2 style="margin:0 0 12px;color:#0f172a;font-size:18px;">Your sign-in code</h2>
        <p style="color:#475569;margin:0 0 18px;">Enter this 5-digit code at <a href="https://curriculate.net/stocks" style="color:#2563eb;">curriculate.net/stocks</a> to sign in.</p>
        <p style="font-size:2rem;font-weight:700;letter-spacing:.4em;background:#eff6ff;color:#1e40af;padding:.75rem 1.5rem;border-radius:10px;display:inline-block;font-family:'SF Mono',Menlo,monospace;">${pin}</p>
        <p style="color:#64748b;font-size:.9rem;margin-top:18px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this message.</p>
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0;" />
        <p style="color:#94a3b8;font-size:.8rem;margin:0;">Stocks Advisor by Curriculate · Research and education only. Not licensed investment advice.</p>
      </div>`,
      headers: { "X-Entity-Ref-ID": `stocks-pin-${Date.now()}` },
    });

    if (send.error) {
      console.error("Resend PIN error:", send.error);
      return NextResponse.json({ error: "Could not send code" }, { status: 502 });
    }

    return NextResponse.json({ token, expiresIn: 600 });
  } catch (err) {
    console.error("stocks request-pin error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
