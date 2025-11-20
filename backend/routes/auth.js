// backend/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();

// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      passwordHash,
      name,
      // default subscription tier
      subscriptionTier: "FREE",
    });

    return res.json({
      ok: true,
      user: { id: user._id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Bad credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: "Bad credentials" });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        plan: user.plan || { tier: "free" },
      },
      process.env.JWT_SECRET || "devsecret",
      { expiresIn: "7d" }
    );

    //login success response:
return res.json({
  ok: true,
  token,
  user: {
    id: user._id,
    email: user.email,
    name: user.name,
    subscriptionTier: user.subscriptionTier || "FREE",
    // optional synthetic plan object if you like:
    plan: { tier: (user.subscriptionTier || "FREE").toLowerCase() },
  },
});

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /auth/me
router.get("/me", authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      ok: true,
      id: user._id,
      email: user.email,
      name: user.name,
      subscriptionTier: user.subscriptionTier || "FREE",
      plan: { tier: (user.subscriptionTier || "FREE").toLowerCase() },
    });
  } catch (err) {
    console.error("Me route error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
