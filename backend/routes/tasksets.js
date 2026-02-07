// backend/routes/tasksets.js
import express from "express";
import jwt from "jsonwebtoken";
import TaskSet from "../models/TaskSet.js";

const router = express.Router();

/**
 * Self-contained auth middleware.
 * If you prefer your shared authRequired middleware, swap it in here.
 */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ ok: false, error: "No token" });

  const token = h.split(" ")[1];
  if (!token) return res.status(401).json({ ok: false, error: "No token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

/**
 * Helper: query that includes either:
 * - sets owned by this user
 * - OR sets that have no owner field (legacy)
 */
function ownedOrLegacyQuery(userId) {
  return {
    $or: [{ owner: userId }, { owner: { $exists: false } }, { owner: null }],
  };
}

/**
 * Create a task set (manual save endpoint).
 * POST /api/tasksets
 */
router.post("/", auth, async (req, res) => {
  try {
    const b = req.body || {};
    const now = new Date();

    const doc = await TaskSet.create({
      ...b,
      owner: b.owner ?? req.userId, // prefer explicit if caller passes, else set to user
      createdAt: b.createdAt ?? now,
      updatedAt: now,
    });

    return res.status(201).json({ ok: true, taskset: doc });
  } catch (err) {
    console.error("POST /api/tasksets error:", err);
    return res.status(500).json({ ok: false, error: "Failed to create task set" });
  }
});

/**
 * List tasksets (what the teacher-app expects).
 * GET /api/tasksets
 */
router.get("/", auth, async (req, res) => {
  try {
    const sets = await TaskSet.find(ownedOrLegacyQuery(req.userId))
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ ok: true, tasksets: sets });
  } catch (err) {
    console.error("GET /api/tasksets error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Legacy "mine" route (keep if something uses it).
 * GET /api/tasksets/mine
 *
 * IMPORTANT: this must come BEFORE "/:id"
 */
router.get("/mine", auth, async (req, res) => {
  try {
    const sets = await TaskSet.find(ownedOrLegacyQuery(req.userId))
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ ok: true, tasksets: sets });
  } catch (err) {
    console.error("GET /api/tasksets/mine error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Public gallery
 * GET /api/tasksets/public
 *
 * IMPORTANT: this must come BEFORE "/:id"
 */
router.get("/public", async (req, res) => {
  try {
    const sets = await TaskSet.find({ isPublic: true })
      .sort({ "usageStats.totalPlays": -1, updatedAt: -1 })
      .lean();

    return res.json({ ok: true, tasksets: sets });
  } catch (err) {
    console.error("GET /api/tasksets/public error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Get a single taskset by id
 * GET /api/tasksets/:id
 */
router.get("/:id", auth, async (req, res) => {
  try {
    const set = await TaskSet.findOne({
      _id: req.params.id,
      ...ownedOrLegacyQuery(req.userId),
    }).lean();

    if (!set) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, taskset: set });
  } catch (err) {
    console.error("GET /api/tasksets/:id error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Update a taskset
 * PUT /api/tasksets/:id
 */
router.put("/:id", auth, async (req, res) => {
  try {
    const b = req.body || {};
    const updated = await TaskSet.findOneAndUpdate(
      { _id: req.params.id, ...ownedOrLegacyQuery(req.userId) },
      { $set: { ...b, updatedAt: new Date() } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, taskset: updated });
  } catch (err) {
    console.error("PUT /api/tasksets/:id error:", err);
    return res.status(500).json({ ok: false, error: "Failed to update task set" });
  }
});

/**
 * Delete a taskset
 * DELETE /api/tasksets/:id
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const deleted = await TaskSet.findOneAndDelete({
      _id: req.params.id,
      ...ownedOrLegacyQuery(req.userId),
    });

    if (!deleted) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasksets/:id error:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete task set" });
  }
});

export default router;
