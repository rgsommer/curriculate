// backend/routes/auth.js
import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcrypt";

const router = express.Router();

/**
 * ASSUMPTION:
 * You have a User model with at least:
 *  - email: String
 *  - passwordHash: String
 *
 * If your project uses a different user model name/fields,
 * update getUserByEmail() + setUserPassword().
 */
const User = mongoose.models.User; // or import User from "../models/User.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function getUserByEmail(email) {
  if (!User) return null;
  return await User.findOne({ email: normalizeEmail(email) });
}

async function setUserPassword(user, newPassword) {
  const hash = await bcrypt.hash(String(newPassword), 10);
  // adjust field name if yours differs
  user.passwordHash = hash;
  await user.save();
}

/**
 * Password reset token store (separate collection)
 * Keeps auth clean and avoids storing raw tokens.
 */
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

/**
 * POST /forgot-password
 * Body: { email }
 *
 * Always returns { ok:true } to avoid account enumeration.
 * In dev: logs a reset link (token) to server console.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const user = await getUserByEmail(email);

    // Always respond ok=true (anti-enumeration)
    res.json({ ok: true });

    if (!user) return;

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const isDev =
      process.env.NODE_ENV !== "production" ||
      process.env.RETURN_RESET_TOKEN === "true";

    if (isDev) {
      return res.json({
        ok: true,
        // dev-only: lets you test without email
        resetToken: rawToken,
        email,
      });
    }

    // prod behavior: don't reveal anything
    return res.json({ ok: true });

    // 30 min expiry (tweak)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await PasswordReset.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });

    // In prod you'd email the link; in dev we print it.
    const appBase =
      process.env.APP_BASE_URL ||
      process.env.TEACHER_APP_URL ||
      "http://localhost:5173";

    const resetLink = `${appBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(
      email
    )}`;

    console.log("🔐 Password reset link (dev):", resetLink);
  } catch (err) {
    console.error("POST /forgot-password failed:", err);
    // still avoid enumeration; return generic ok
    res.status(200).json({ ok: true });
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
