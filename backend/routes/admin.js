// backend/routes/admin.js
import express from "express";
import jwt from "jsonwebtoken";

import TaskSet from "../models/TaskSet.js";
import User from "../models/User.js";

const router = express.Router();

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

function isUserAdmin(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return (
    user?.isAdmin === true ||
    user?.role === "admin" ||
    user?.userType === "admin" ||
    roles.includes("admin")
  );
}

/**
 * Auth middleware:
 * - expects Authorization: Bearer <jwt>
 * - attaches req.user (fresh from Mongo)
 *
 * IMPORTANT: Your auth.js signs tokens with { userId, email, name, ... }.
 * This middleware uses payload.userId (and falls back to payload.id).
 */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    let payload;
    try {
      payload = jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    const userId = payload?.userId || payload?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Invalid token payload" });

    const user = await User.findById(userId).lean();
    if (!user) return res.status(401).json({ ok: false, error: "User not found" });

    req.auth = payload;
    req.user = user;
    req.userId = String(user._id);

    return next();
  } catch (e) {
    console.error("[admin] requireAuth failed:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });
  if (!isUserAdmin(req.user)) return res.status(403).json({ ok: false, error: "Admin only" });
  return next();
}

// --------------------
// Admin routes
// --------------------

router.get("/metrics", requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.countDocuments();
    const publicSets = await TaskSet.countDocuments({ isPublic: true });
    const totalSets = await TaskSet.countDocuments();
    return res.json({ ok: true, users, publicSets, totalSets });
  } catch (e) {
    console.error("[admin] /metrics failed:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
