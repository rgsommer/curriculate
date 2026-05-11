/**
 * POST /api/medicentre/request-pin
 *
 * Generates a 5-digit verification PIN, emails it to the supplied address,
 * and returns a stateless signed token that carries a hash of the PIN.
 *
 * The client then submits the PIN back via /api/medicentre/appointments
 * along with the token; the server verifies the signature and the hash.
 *
 * No DB or session storage is required.
 *
 * Required env vars:
 *   RESEND_API_KEY              — Resend API key (already used by /api/contact)
 *   MEDICENTRE_SECRET           — any long random string for HMAC signing
 *   MEDICENTRE_FROM             — From: line, e.g. "St. George Medical Centre <noreply@curriculate.net>"
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

// ---------- tiny per-IP rate limit (4 / 10 min) ----------
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 4;
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

// ---------- token signing (stateless HMAC) ----------
function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signToken(payload: object) {
  const secret = process.env.MEDICENTRE_SECRET;
  if (!secret) throw new Error("MEDICENTRE_SECRET not configured");
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function pinHash(pin: string, email: string) {
  const secret = process.env.MEDICENTRE_SECRET || "";
  return crypto.createHash("sha256").update(pin + "|" + email.toLowerCase() + "|" + secret).digest("hex");
}

// ---------- handler ----------
export async function POST(req: Request) {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.MEDICENTRE_SECRET) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const ip = getClientIp(req);
    if (!rateOk(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a few minutes." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const firstName = typeof body?.firstName === "string" ? body.firstName.trim().slice(0, 60) : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // generate 5-digit PIN
    const pin = String(Math.floor(10000 + Math.random() * 90000));

    // build stateless token: payload contains email + pin hash + expiry
    const exp = Math.floor(Date.now() / 1000) + 10 * 60; // 10 minutes
    const token = signToken({
      email: email.toLowerCase(),
      ph: pinHash(pin, email),
      exp,
    });

    // send the PIN by email
    const from = process.env.MEDICENTRE_FROM ||
      "St. George Medical Centre <noreply@curriculate.net>";

    const send = await resend.emails.send({
      from,
      to: email,
      subject: `Your St. George Medical Centre verification code: ${pin}`,
      text: `Hi ${firstName || "there"},

Your appointment-request verification code is:

    ${pin}

Enter this 5-digit code on the booking page to confirm your request.
This code expires in 10 minutes.

If you didn't request an appointment, you can ignore this message.

— St. George Medical Centre Waterdown
250 Dundas St E, Unit 3, Waterdown, ON L8B 0E7
(289) 895-7862`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#1F2A35;">
<p>Hi ${escapeHtml(firstName || "there")},</p>
<p>Your appointment-request verification code is:</p>
<p style="font-size:2rem;font-weight:700;letter-spacing:.4em;background:#E6F2F7;color:#074463;padding:.75rem 1.25rem;border-radius:8px;display:inline-block;font-family:'SF Mono',Menlo,monospace;">${pin}</p>
<p>Enter this 5-digit code on the booking page to confirm your request. This code expires in 10 minutes.</p>
<p style="color:#5A6B78;font-size:.9rem;">If you didn't request an appointment, you can safely ignore this message.</p>
<hr style="border:0;border-top:1px solid #E1E8EC;margin:1.5rem 0;" />
<p style="color:#5A6B78;font-size:.85rem;">
  St. George Medical Centre Waterdown<br>
  250 Dundas St E, Unit 3 · Waterdown, ON L8B 0E7<br>
  <a href="tel:+12898957862" style="color:#0E5C7E;">(289) 895-7862</a>
</p>
</div>`,
      headers: { "X-Entity-Ref-ID": `medicentre-pin-${Date.now()}` },
    });

    if (send.error) {
      console.error("Resend PIN error:", send.error);
      return NextResponse.json({ error: "Could not send verification code" }, { status: 502 });
    }

    return NextResponse.json({ token, expiresIn: 600 });
  } catch (err) {
    console.error("request-pin error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
