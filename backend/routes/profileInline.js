import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import User from "../models/User.js";
import TeacherProfile from "../models/TeacherProfile.js";

const router = express.Router();

// Helper functions
function getOwnerId(req) {
  return String(req.user?._id || req.user?.userId || req.user?.id || req.userId || "").trim();
}

async function getOrCreateProfileForUser({ ownerId, email } = {}) {
  if (!ownerId) throw new Error("Missing ownerId");

  let profile = await TeacherProfile.findOne({ ownerId });

  if (!profile) {
    profile = new TeacherProfile({
      ownerId,
      email: email || "",
    });
    await profile.save();
    return profile;
  }

  if (email && !profile.email) {
    profile.email = email;
    await profile.save();
  }

  return profile;
}

// GET /api/profile/me
router.get("/me", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const profile = await getOrCreateProfileForUser({ ownerId, email: req.user?.email });
    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";
    res.json(plain);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// GET /api/profile
// Returns the full profile — same as GET /api/profile/me.
// Previously this returned only a small subset of fields.
router.get("/", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const profile = await getOrCreateProfileForUser({
      ownerId,
      email: req.user?.email || "",
    });

    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";

    // Include a few extra convenience fields
    plain.userId = ownerId;
    plain.isAdmin = !!(profile.isAdmin || req.user?.isAdmin);

    return res.json(plain);
  } catch (e) {
    console.error("GET /api/profile failed:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// PUT /api/profile/me
router.put("/me", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const profile = await getOrCreateProfileForUser({ ownerId, email: req.user?.email });

    const body = { ...req.body };
    if (body.presenterTitle && !body.title) body.title = body.presenterTitle;
    if (body.title && !body.presenterTitle) body.presenterTitle = body.title;

    Object.assign(profile, body);
    await profile.save();

    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";
    res.json(plain);
  } catch (err) {
    console.error("Profile update failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// PUT /api/profile
// Legacy endpoint — delegates to the same logic as PUT /api/profile/me.
// Previously this was broken (queried by userId instead of ownerId and only saved locationOptions).
router.put("/", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const profile = await getOrCreateProfileForUser({ ownerId, email: req.user?.email });

    const body = { ...req.body };
    if (body.presenterTitle && !body.title) body.title = body.presenterTitle;
    if (body.title && !body.presenterTitle) body.presenterTitle = body.title;

    Object.assign(profile, body);
    await profile.save();

    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";
    return res.json(plain);
  } catch (err) {
    console.error("PUT /api/profile error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
