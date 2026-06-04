// backend/routes/subsAuth.js
//
// Passwordless email-PIN sign-in for the /subs app, shared by school
// admins and substitute teachers (the same email may be both). Mirrors
// the stocks auth route: stateful PIN with attempt lockout, then an
// HMAC-signed session cookie.
//
//   POST /request-pin  { email }       → emails a 6-digit code
//   POST /verify-pin   { email, pin }  → sets subs_session cookie
//   POST /logout                       → clears the cookie
//   GET  /me                           → who am I + my roles
//
// Local dev: with no RESEND_API_KEY the PIN is logged to the server
// console, and (only when NODE_ENV !== production) returned as `devPin`
// so you can sign in without an email provider.

import express from "express";
import crypto from "crypto";
import SubsAuthPin from "../models/SubsAuthPin.js";
import SubsSchool from "../models/SubsSchool.js";
import SubsTeacher from "../models/SubsTeacher.js";
import {
  getSubsSecret,
  signSubsSession,
  verifySubsSession,
  getSubsToken,
  subsCookieOpts,
  SUBS_COOKIE_NAME,
  SESSION_TTL_SEC,
} from "../services/subsAuthToken.js";

const router = express.Router();

const PIN_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function pinHmac(pin, email, secret) {
  return crypto.createHmac("sha256", secret).update(`${pin}|${email.toLowerCase()}`).digest("hex");
}

async function sendPinEmail(to, pin) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[subs:auth:MOCK] sign-in code for ${to}: ${pin}\n`);
    return;
  }
  const from = process.env.SUBS_FROM || "Curriculate Subs <noreply@curriculate.net>";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f172a;max-width:520px;margin:24px auto;padding:24px;">
    <h2 style="margin:0 0 12px;font-size:18px;">Your sign-in code</h2>
    <p style="color:#475569;margin:0 0 18px;">Enter this 6-digit code at <a href="https://curriculate.net/subs" style="color:#2563eb;">curriculate.net/subs</a> to sign in.</p>
    <p style="font-size:2rem;font-weight:700;letter-spacing:.4em;background:#eff6ff;color:#1e40af;padding:.75rem 1.5rem;border-radius:10px;display:inline-block;font-family:'SF Mono',Menlo,monospace;">${pin}</p>
    <p style="color:#64748b;font-size:.9rem;margin-top:18px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this message.</p>
  </div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your Curriculate Subs sign-in code: ${pin}`,
      text: `Your sign-in code is: ${pin}\n\nEnter this 6-digit code at curriculate.net/subs to sign in.\nThis code expires in 10 minutes.`,
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
    const secret = getSubsSecret();
    if (!secret) return res.status(500).json({ error: "Server config missing: SUBS_SECRET not set" });

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });

    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await SubsAuthPin.findOneAndUpdate(
      { email },
      { $set: { pinHash: pinHmac(pin, email, secret), attempts: 0, consumed: false, expiresAt: new Date(Date.now() + PIN_TTL_MS) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await sendPinEmail(email, pin);

    const out = { ok: true, expiresIn: PIN_TTL_MS / 1000 };
    // Dev convenience only — never leak the PIN in production.
    if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) out.devPin = pin;
    return res.json(out);
  } catch (err) {
    console.error("subs-auth request-pin error:", err);
    return res.status(502).json({ error: `Could not send code: ${err?.message || err}` });
  }
});

router.post("/verify-pin", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const secret = getSubsSecret();
    if (!secret) return res.status(500).json({ error: "Server config missing: SUBS_SECRET not set" });

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 6 digits" });

    const now = new Date();
    const rec = await SubsAuthPin.findOneAndUpdate(
      { email, consumed: false, expiresAt: { $gt: now } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!rec) return res.status(401).json({ error: "No active code — request a new one." });
    if (rec.attempts > MAX_ATTEMPTS) return res.status(429).json({ error: "Too many incorrect attempts. Request a new code." });

    const expected = rec.pinHash;
    const actual = pinHmac(pin, email, secret);
    const ok =
      expected.length === actual.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    if (!ok) {
      const left = Math.max(0, MAX_ATTEMPTS - rec.attempts);
      return res.status(401).json({ error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect code. Request a new one." });
    }

    rec.consumed = true;
    await rec.save();
    const token = signSubsSession(email, secret);
    res.cookie(SUBS_COOKIE_NAME, token, { ...subsCookieOpts(), maxAge: SESSION_TTL_SEC * 1000 });
    return res.json({ ok: true, sessionToken: token });
  } catch (err) {
    console.error("subs-auth verify-pin error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(SUBS_COOKIE_NAME, subsCookieOpts());
  return res.json({ ok: true });
});

// Identity + roles for the signed-in email. The frontend uses this to
// decide which dashboard(s) to show. An email can be both an admin (of one
// or more schools) and a registered substitute teacher.
router.get("/me", async (req, res) => {
  const token = getSubsToken(req);
  const payload = token ? verifySubsSession(token) : null;
  if (!payload) return res.status(401).json({ error: "Not signed in" });
  const email = payload.email.toLowerCase();
  const [schools, teacher] = await Promise.all([
    SubsSchool.find({ adminEmails: email }).select("name location").lean(),
    SubsTeacher.findOne({ email }).lean(),
  ]);
  return res.json({
    email,
    isAdmin: schools.length > 0,
    adminSchools: schools,
    isTeacher: !!teacher,
    teacher: teacher || null,
  });
});

export default router;
