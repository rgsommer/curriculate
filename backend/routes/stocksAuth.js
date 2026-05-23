// backend/routes/stocksAuth.js
//
// Passwordless email-PIN sign-in for the /stocks advisor.
//
//   POST /request-pin   { email }                 → emails a 6-digit code
//   POST /verify-pin     { email, pin }            → { ok, sessionToken }
//
// Why this lives in the backend (not the Vercel /api/stocks routes it
// replaces): verification MUST be stateful so we can count attempts and
// lock out brute-force. The old design returned a stateless token whose
// payload contained the PIN hash, letting an attacker request a token for
// any email and then brute-force the 5-digit space against an unmetered
// verify endpoint — a full account takeover. Here the PIN hash is stored
// server-side (StocksAuthPin), attempts are capped, and the route sits
// behind the shared authLimiter in index.js.
//
// The issued sessionToken is byte-compatible with the HMAC scheme that
// stocksPortfolio.js / stocksTrade.js / stocksAdvice.js verify.

import express from "express";
import crypto from "crypto";
import StocksAuthPin from "../models/StocksAuthPin.js";

const router = express.Router();

const PIN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5; // verify guesses allowed per issued PIN
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const COOKIE_NAME = "stocks_session";

// Cookie options for the session credential. HttpOnly keeps it out of reach
// of any XSS on the (large, shared) curriculate.net origin; SameSite=Lax
// blocks it on cross-site POST/PUT (CSRF mitigation) while still riding
// cross-subdomain XHR (curriculate.net → api.curriculate.net is same-site).
// In dev we drop Secure + domain so localhost→localhost works.
function cookieOpts() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    ...(isProd ? { domain: process.env.CURRICULATE_COOKIE_DOMAIN || ".curriculate.net" } : {}),
    path: "/",
  };
}

function getSecret() {
  return process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET || "";
}

function b64url(buf) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// HMAC the PIN (keyed by the signing secret) so a DB read can't reveal it
// and so comparison is over a fixed-length digest for constant-time checks.
function pinHmac(pin, email, secret) {
  return crypto.createHmac("sha256", secret).update(`${pin}|${email.toLowerCase()}`).digest("hex");
}

function signSession(email, secret) {
  const payload = { email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC, sub: "stocks-session" };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

async function sendPinEmail(to, pin) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const from = process.env.STOCKS_FROM || "Stocks Advisor <noreply@curriculate.net>";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f172a;max-width:520px;margin:24px auto;padding:24px;">
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:18px;">Your sign-in code</h2>
    <p style="color:#475569;margin:0 0 18px;">Enter this 6-digit code at <a href="https://curriculate.net/stocks" style="color:#2563eb;">curriculate.net/stocks</a> to sign in.</p>
    <p style="font-size:2rem;font-weight:700;letter-spacing:.4em;background:#eff6ff;color:#1e40af;padding:.75rem 1.5rem;border-radius:10px;display:inline-block;font-family:'SF Mono',Menlo,monospace;">${pin}</p>
    <p style="color:#64748b;font-size:.9rem;margin-top:18px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this message.</p>
    <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0;" />
    <p style="color:#94a3b8;font-size:.8rem;margin:0;">Stocks Advisor by Curriculate · Research and education only. Not licensed investment advice.</p>
  </div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your Stocks Advisor sign-in code: ${pin}`,
      text: `Your sign-in code is: ${pin}\n\nEnter this 6-digit code at curriculate.net/stocks to sign in.\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can ignore this message.`,
      html,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${body.slice(0, 200)}`);
  }
}

router.post("/request-pin", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const secret = getSecret();
    if (!secret) return res.status(500).json({ error: "Server config missing: STOCKS_SECRET not set" });
    if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: "Server config missing: RESEND_API_KEY not set" });

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });

    // 6-digit, cryptographically random, uniformly distributed.
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

    // Upsert the single active record for this email — issuing a new code
    // invalidates any prior one and resets the attempt counter.
    await StocksAuthPin.findOneAndUpdate(
      { email },
      { $set: { pinHash: pinHmac(pin, email, secret), attempts: 0, consumed: false, expiresAt: new Date(Date.now() + PIN_TTL_MS) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await sendPinEmail(email, pin);
    return res.json({ ok: true, expiresIn: PIN_TTL_MS / 1000 });
  } catch (err) {
    console.error("stocks-auth request-pin error:", err);
    return res.status(502).json({ error: `Could not send code: ${err?.message || err}` });
  }
});

router.post("/verify-pin", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const secret = getSecret();
    if (!secret) return res.status(500).json({ error: "Server config missing: STOCKS_SECRET not set" });

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 6 digits" });

    // Atomically claim one attempt against the active, unconsumed, unexpired
    // record. The $inc + filter makes concurrent guesses race-safe.
    const now = new Date();
    const rec = await StocksAuthPin.findOneAndUpdate(
      { email, consumed: false, expiresAt: { $gt: now } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!rec) return res.status(401).json({ error: "No active code — request a new one." });
    if (rec.attempts > MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many incorrect attempts. Request a new code." });
    }

    const expected = rec.pinHash;
    const actual = pinHmac(pin, email, secret);
    const ok =
      expected.length === actual.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    if (!ok) {
      const left = Math.max(0, MAX_ATTEMPTS - rec.attempts);
      return res.status(401).json({ error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect code. Request a new one." });
    }

    // Burn the PIN so it can't be replayed, then issue the session.
    rec.consumed = true;
    await rec.save();
    const token = signSession(email, secret);
    // Primary credential is the HttpOnly cookie. The token is still returned
    // in the body for transition/rollback, but the client no longer persists
    // it — the cookie is the source of truth across reloads.
    res.cookie(COOKIE_NAME, token, { ...cookieOpts(), maxAge: SESSION_TTL_SEC * 1000 });
    return res.json({ ok: true, sessionToken: token });
  } catch (err) {
    console.error("stocks-auth verify-pin error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// Clear the session cookie. Body-less; the cookie itself is the credential.
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOpts());
  return res.json({ ok: true });
});

export default router;
