// backend/routes/auth.js
import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import User from "../models/User.js";
import TeacherProfile from "../models/TeacherProfile.js";
import AccessCode from "../models/AccessCode.js";

const router = express.Router();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set in environment.");
  }
  return secret;
}

function signAuthToken(user) {
  const secret = requireJwtSecret();
  // Keep payload minimal; authRequired can look at these
  const payload = {
    userId: String(user._id),
    email: user.email,
    name: user.name || "",
  };
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

async function getUserByEmail(email) {
  return await User.findOne({ email: normalizeEmail(email) });
}

async function setUserPassword(user, newPassword) {
  const hash = await bcrypt.hash(String(newPassword), 10);
  user.passwordHash = hash;
  await user.save();
}

// --------------------------------------------------------------------
// PASSWORD RESET TOKEN STORE
// --------------------------------------------------------------------
const PasswordResetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PasswordReset =
  mongoose.models.PasswordReset || mongoose.model("PasswordReset", PasswordResetSchema);

function isDevReturnEnabled() {
  const v = String(process.env.RETURN_RESET_TOKEN || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  return process.env.NODE_ENV !== "production";
}

function buildResetLink(email, rawToken) {
  const appBase =
    process.env.APP_BASE_URL ||
    process.env.TEACHER_APP_URL ||
    "http://localhost:5173";

  return `${String(appBase).replace(/\/+$/, "")}/reset-password?token=${rawToken}&email=${encodeURIComponent(
    email
  )}`;
}

// --------------------------------------------------------------------
// AUTH ROUTES
// --------------------------------------------------------------------

/**
 * POST /signup
 * Body: { email, password, name? }
 * Returns: { ok:true, token, user }
 */
router.post("/signup", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password too short (min 8)" });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, name, passwordHash });

    // Optional: create a TeacherProfile shell so profile/me works immediately
    try {
      const ownerId = String(user._id);
      let profile = await TeacherProfile.findOne({ ownerId });
      if (!profile) {
        profile = new TeacherProfile({ ownerId, email });
        await profile.save();
      }
    } catch (e) {
      console.warn("signup: TeacherProfile create skipped/failed:", e?.message || e);
    }

    const token = signAuthToken(user);

    return res.json({
      ok: true,
      token,
      user: { userId: String(user._id), email: user.email, name: user.name || "" },
    });
  } catch (err) {
    console.error("POST /signup failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /login
 * Body: { email, password }
 * Returns: { ok:true, token, user }
 */
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const token = signAuthToken(user);

    return res.json({
      ok: true,
      token,
      user: { userId: String(user._id), email: user.email, name: user.name || "" },
    });
  } catch (err) {
    console.error("POST /login failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /signup-with-code
 * Body: { email, password, name?, accessCode }
 * Creates user + creates/updates TeacherProfile.entryCode + claims AccessCode seat
 */
router.post("/signup-with-code", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    const accessCode = String(req.body?.accessCode || "").trim().toUpperCase();

    if (!email || !password || !accessCode) {
      return res.status(400).json({ ok: false, error: "Missing email, password, or accessCode" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password too short (min 8)" });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: "Email already in use" });
    }

    const access = await AccessCode.findOne({ code: accessCode });
    if (!access) return res.status(404).json({ ok: false, error: "Code not found" });
    if (access.disabled) return res.status(403).json({ ok: false, error: "Code disabled" });

    const maxSeats = Math.max(1, Number(access.maxSeats || 1));
    const claimants = Array.isArray(access.claimants) ? access.claimants : [];

    if (claimants.length >= maxSeats) {
      return res.status(403).json({ ok: false, error: "Code already fully claimed" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, name, passwordHash });
    const ownerId = String(user._id);

    // Create or update profile + attach entryCode
    let profile = await TeacherProfile.findOne({ ownerId });
    if (!profile) profile = new TeacherProfile({ ownerId, email });
    profile.entryCode = accessCode;
    await profile.save();

    // Claim seat
    access.claimants = claimants.concat(ownerId);
    await access.save();

    const token = signAuthToken(user);

    return res.json({
      ok: true,
      token,
      user: { userId: ownerId, email: user.email, name: user.name || "" },
      entryCode: accessCode,
      planTier: access.planTier || "FREE",
    });
  } catch (err) {
    console.error("POST /signup-with-code failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --------------------------------------------------------------------
// PASSWORD RESET (your existing behavior preserved)
// --------------------------------------------------------------------

/**
 * POST /forgot-password
 * Body: { email }
 * Always returns { ok:true } to avoid enumeration.
 * Dev: returns resetToken/resetLink if enabled.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const user = await getUserByEmail(email);

    // Anti-enumeration
    if (!user) return res.json({ ok: true });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await PasswordReset.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });

    const resetLink = buildResetLink(email, rawToken);

    console.log("🔐 Password reset link (dev):", resetLink);
    console.log("[forgot-password] email =", email, "userFound =", !!user);
    console.log("[forgot-password] NODE_ENV =", process.env.NODE_ENV);
    console.log("[forgot-password] RETURN_RESET_TOKEN =", process.env.RETURN_RESET_TOKEN);
    console.log("[forgot-password] devReturn =", isDevReturnEnabled());

    if (isDevReturnEnabled()) {
      return res.json({ ok: true, resetToken: rawToken, resetLink });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /forgot-password failed:", err);
    return res.status(200).json({ ok: true });
  }
});

/**
 * POST /reset-password
 * Body: { email, token, newPassword }
 */
router.post("/reset-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !token || !newPassword) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: "Password too short (min 8)" });
    }

    const user = await getUserByEmail(email);
    if (!user) return res.status(400).json({ ok: false, error: "Invalid token" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const record = await PasswordReset.findOne({
      userId: user._id,
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return res.status(400).json({ ok: false, error: "Invalid token" });
    }

    await setUserPassword(user, newPassword);

    record.usedAt = new Date();
    await record.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /reset-password failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
