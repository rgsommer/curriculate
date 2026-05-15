/**
 * POST /api/stocks/verify-pin
 *
 * Body: { email, pin, token }  (token is from /request-pin)
 *
 * Verifies the HMAC signature on the token, checks expiry, and confirms
 * that hash(pin + email) matches the hash baked into the token.
 *
 * On success returns { ok: true, sessionToken } — a longer-lived signed
 * token (30 days) the client can present on future protected routes
 * (e.g., portfolio persistence endpoints once we move off localStorage).
 */

import { NextResponse } from "next/server";
import crypto from "crypto";

function b64urlDecode(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getSecret(): string | null {
  return process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET || null;
}

function verifyToken(token: string, secret: string): { email: string; ph: string; exp: number } | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (typeof payload?.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function pinHash(pin: string, email: string, secret: string) {
  return crypto
    .createHash("sha256")
    .update(pin + "|" + email.toLowerCase() + "|" + secret)
    .digest("hex");
}

function signSession(email: string, secret: string) {
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days
  const payload = { email, exp, sub: "stocks-session" };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export async function POST(req: Request) {
  try {
    const secret = getSecret();
    if (!secret) {
      return NextResponse.json(
        { error: "Server config missing: STOCKS_SECRET not set" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
    const token = typeof body?.token === "string" ? body.token : "";

    if (!email || !pin || !token) {
      return NextResponse.json({ error: "Missing email, pin, or token" }, { status: 400 });
    }
    if (!/^\d{5}$/.test(pin)) {
      return NextResponse.json({ error: "PIN must be 5 digits" }, { status: 400 });
    }

    const payload = verifyToken(token, secret);
    if (!payload) return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    if (payload.email !== email) {
      return NextResponse.json({ error: "Email mismatch" }, { status: 401 });
    }

    const expected = pinHash(pin, email, secret);
    if (
      payload.ph.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(payload.ph), Buffer.from(expected))
    ) {
      return NextResponse.json({ error: "Incorrect code" }, { status: 401 });
    }

    return NextResponse.json({ ok: true, sessionToken: signSession(email, secret) });
  } catch (err) {
    console.error("stocks verify-pin error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Internal error: ${msg}` }, { status: 500 });
  }
}
