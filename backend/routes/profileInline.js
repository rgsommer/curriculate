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
router.get("/", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const profile = await getOrCreateProfileForUser({
      ownerId,
      email: req.user?.email || "",
    });

    return res.json({
      ok: true,
      userId: ownerId,
      email: (req.user?.email || profile.email || "").toLowerCase(),
      name: req.user?.name || profile.presenterName || profile.displayName || "",
      isAdmin: !!(profile.isAdmin || req.user?.isAdmin),
      entryCode: profile.entryCode || "",     // IMPORTANT: your schema defaults to ""
      planTier: null,
      // ✅ Rooms for multi-room (fix: always return it)
      locationOptions: Array.isArray(profile.locationOptions)
        ? profile.locationOptions
        : ["Classroom"],
      // Optional passthrough
      treatsPerSession:
        typeof profile.treatsPerSession === "number"
          ? profile.treatsPerSession
          : undefined,
    });
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
router.put("/", authRequired, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const profile = await TeacherProfile.findOne({ userId });
    if (!profile) return res.status(404).json({ ok: false, error: "Profile not found" });

    // --- MULTI-ROOM: persist teacher-defined room list ---
    if ("locationOptions" in (req.body || {})) {
      const raw = Array.isArray(req.body.locationOptions) ? req.body.locationOptions : [];
      const cleaned = Array.from(
        new Set(
          raw
            .map((s) => (s || "").toString().trim())
            .filter(Boolean)
        )
      );
      profile.locationOptions = cleaned.length ? cleaned : ["Classroom"];
    }

    await profile.save();
    return res.json(profile);
  } catch (err) {
    console.error("PUT /api/profile error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
