// backend/routes/pulseBeta.js
// Signup + activation for Pulse Grading's free 1-year beta program.
//
// Flow:
//   1. Teacher fills the beta form on /pulse and POSTs to /pulse/beta/signup.
//      Server creates a PulseBetaTester record with a fresh betaCode and a
//      365-day expiry, and returns the betaCode + expiry in the response.
//   2. Client stores the betaCode in localStorage and includes it in the
//      meta.betaCode field on every subsequent /grading POST.
//   3. checkFreemiumGate (in index.js) verifies the code against the model
//      and treats an active beta tester as Plus (skipping the quota).
//
// A separate GET /pulse/beta/lookup lets a teacher look up (and re-activate
// after a browser wipe / new device) using their email + betaCode.

import express from "express";
import crypto from "crypto";
import PulseBetaTester from "../models/PulseBetaTester.js";

const router = express.Router();

// Human-friendly code generator — 6 chars, uppercase alphanumerics minus
// visually-confusing pairs. Prefixed so it's obvious what it is when someone
// pastes it into a chat: "PULSE-BETA-A7X9K4".
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I 1 O 0
function newBetaCode() {
  let out = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `PULSE-BETA-${out}`;
}

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

// -----------------------------------------------------------------------------
// POST /pulse/beta/signup
// Body: { email, name?, school?, role?, subjectArea?, gradeBand?, whyInterested? }
// Response: { ok, betaCode, expiresAt, alreadyEnrolled? }
// -----------------------------------------------------------------------------
router.post("/signup", async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !VALID_EMAIL.test(email)) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    // If this teacher already has an active beta, return it — no duplicate
    // records, no confusing "here's another code."
    const existing = await PulseBetaTester.findOne({ email, revokedAt: null }).lean();
    if (existing && existing.expiresAt > new Date()) {
      return res.json({
        ok: true,
        alreadyEnrolled: true,
        betaCode: existing.betaCode,
        expiresAt: existing.expiresAt,
        name: existing.name || null,
      });
    }

    // Generate a unique code. Retries handle the astronomically-unlikely
    // collision on the unique index — 32^6 = ~1B possible codes.
    let betaCode = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = newBetaCode();
      const clash = await PulseBetaTester.exists({ betaCode: candidate });
      if (!clash) { betaCode = candidate; break; }
    }
    if (!betaCode) {
      console.error("[pulse-beta] failed to allocate unique beta code after 6 tries");
      return res.status(500).json({ error: "Please try again in a moment." });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const doc = await PulseBetaTester.create({
      betaCode,
      email,
      name: String(body.name || "").trim() || undefined,
      school: String(body.school || "").trim() || undefined,
      role: String(body.role || "").trim() || undefined,
      subjectArea: String(body.subjectArea || "").trim() || undefined,
      gradeBand: String(body.gradeBand || "").trim() || undefined,
      whyInterested: String(body.whyInterested || "").trim().slice(0, 2000) || undefined,
      signedUpAt: now,
      expiresAt,
      signupSource: String(body.source || "pulse-landing"),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
      ip: clientIp(req),
    });

    console.log(`[pulse-beta] new signup ${email} → ${betaCode} (expires ${expiresAt.toISOString()})`);
    return res.json({
      ok: true,
      alreadyEnrolled: false,
      betaCode: doc.betaCode,
      expiresAt: doc.expiresAt,
      name: doc.name || null,
    });
  } catch (err) {
    // Unique-index violation → treat as duplicate signup (idempotent behavior).
    if (err?.code === 11000) {
      return res.status(409).json({ error: "This email is already registered. Use the lookup form to retrieve your code." });
    }
    console.error("POST /pulse/beta/signup error:", err?.message || err);
    return res.status(500).json({ error: "Signup failed. Please try again." });
  }
});

// -----------------------------------------------------------------------------
// POST /pulse/beta/activate
// Body: { betaCode }
// Response: { ok, active, expiresAt, name, daysRemaining }
// The frontend calls this once when a teacher pastes a code into the beta
// activation modal on /grading. On success we mark activatedAt and return
// display info. Missing/expired/revoked → { ok: false }.
// -----------------------------------------------------------------------------
router.post("/activate", async (req, res) => {
  try {
    const raw = String(req.body?.betaCode || "").trim().toUpperCase();
    if (!raw) return res.status(400).json({ ok: false, error: "Missing beta code." });

    const doc = await PulseBetaTester.findOne({ betaCode: raw });
    if (!doc) return res.status(404).json({ ok: false, error: "Beta code not found." });
    if (doc.revokedAt) return res.status(403).json({ ok: false, error: "This beta code was revoked." });
    if (doc.expiresAt <= new Date()) return res.status(410).json({ ok: false, error: "This beta code has expired." });

    if (!doc.activatedAt) {
      doc.activatedAt = new Date();
      await doc.save();
    }
    const daysRemaining = Math.max(0, Math.ceil((doc.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
    return res.json({
      ok: true,
      active: true,
      betaCode: doc.betaCode,
      expiresAt: doc.expiresAt,
      name: doc.name || null,
      daysRemaining,
    });
  } catch (err) {
    console.error("POST /pulse/beta/activate error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Activation failed. Please try again." });
  }
});

// -----------------------------------------------------------------------------
// GET /pulse/beta/lookup?email=xyz
// Returns the beta code for a given email (rate-limited by IP via the parent
// app's gradingLimiter — attached in index.js). Useful when a teacher wipes
// their browser or moves to a new device.
// -----------------------------------------------------------------------------
router.get("/lookup", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email || !VALID_EMAIL.test(email)) {
      return res.status(400).json({ ok: false, error: "Provide a valid email." });
    }
    const doc = await PulseBetaTester.findOne({ email, revokedAt: null }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "No beta enrollment found for that email." });
    if (doc.expiresAt <= new Date()) {
      return res.status(410).json({ ok: false, error: "This beta enrollment has expired.", expiresAt: doc.expiresAt });
    }
    return res.json({
      ok: true,
      betaCode: doc.betaCode,
      expiresAt: doc.expiresAt,
      name: doc.name || null,
    });
  } catch (err) {
    console.error("GET /pulse/beta/lookup error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Lookup failed." });
  }
});

// -----------------------------------------------------------------------------
// Called from checkFreemiumGate to verify + bump usage counters. Not exposed
// as a route — imported directly by index.js. Returns { ok, active, doc } or
// { ok: false } if the code is missing / revoked / expired.
// -----------------------------------------------------------------------------
export async function isActiveBetaCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code || !code.startsWith("PULSE-BETA-")) return { ok: false };
  const doc = await PulseBetaTester.findOne({ betaCode: code });
  if (!doc || doc.revokedAt || doc.expiresAt <= new Date()) return { ok: false };
  // Bump usage counters (fire-and-forget — the caller doesn't wait).
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const patch = {
    $inc: { gradesTotal: 1, gradesThisMonth: doc.monthAnchor === monthKey ? 1 : 0 },
    $set: { lastGradedAt: now },
  };
  if (doc.monthAnchor !== monthKey) {
    // Rolled to a new month — reset the per-month counter to 1 for this grade.
    patch.$set.monthAnchor = monthKey;
    patch.$set.gradesThisMonth = 1;
    delete patch.$inc.gradesThisMonth;
  }
  PulseBetaTester.updateOne({ _id: doc._id }, patch).catch((e) => {
    console.warn("[pulse-beta] usage counter update failed:", e?.message || e);
  });
  return { ok: true, active: true, doc };
}

export default router;
