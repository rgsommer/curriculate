// backend/routes/auth.js
import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcrypt";

const router = express.Router();

// NOTE: adjust if your actual model name differs
import User from "../models/User.js"; // or "../models/UserModel.js"

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function getUserByEmail(email) {
  if (!User) return null;
  return await User.findOne({ email: normalizeEmail(email) });
}

async function setUserPassword(user, newPassword) {
  const hash = await bcrypt.hash(String(newPassword), 10);
  user.passwordHash = hash; // adjust if your field name differs
  await user.save();
}

// Password reset token store
const PasswordResetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// TTL index: expire documents at expiresAt
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PasswordReset =
  mongoose.models.PasswordReset || mongoose.model("PasswordReset", PasswordResetSchema);

function isDevReturnEnabled() {
  const v = String(process.env.RETURN_RESET_TOKEN || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;

  // keep your existing dev behavior too, if you want
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

/**
 * POST /forgot-password
 * Body: { email }
 *
 * Always returns { ok:true } to avoid account enumeration.
 * If RETURN_RESET_TOKEN=true (or non-production), also returns resetToken/resetLink.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const user = await getUserByEmail(email);

    // Anti-enumeration: if user doesn't exist, still return ok:true
    if (!user) return res.json({ ok: true });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // 30 min expiry
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await PasswordReset.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });

    const resetLink = buildResetLink(email, rawToken);

    // Dev: log it
    console.log("🔐 Password reset link (dev):", resetLink);
    console.log("[forgot-password] email =", email, "userFound =", !!user);
    console.log("[forgot-password] NODE_ENV =", process.env.NODE_ENV);
    console.log("[forgot-password] RETURN_RESET_TOKEN =", process.env.RETURN_RESET_TOKEN);
    console.log("[forgot-password] devReturn =", isDevReturnEnabled());
    console.log("[forgot-password] email =", email, "userFound =", !!user);

    console.log("[forgot-password] RETURN_RESET_TOKEN =", process.env.RETURN_RESET_TOKEN, "NODE_ENV =", process.env.NODE_ENV, "devReturn =", isDevReturnEnabled());

    // Dev-only: return token/link so UI can show Copy button
    if (isDevReturnEnabled()) {
      return res.json({ ok: true, resetToken: rawToken, resetLink });
    }

    // Prod: don't reveal token/link
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /forgot-password failed:", err);
    // still avoid enumeration
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

    // mark token used so it can't be reused
    record.usedAt = new Date();
    await record.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /reset-password failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
