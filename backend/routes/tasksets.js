// backend/routes/tasksets.js
import express from "express";
import TaskSet from "../models/TaskSet.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// simple auth middleware
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });
  const token = h.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    req.userId = payload.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ... getTasksetLimitsForTier, getWordLimitForTier unchanged ...

// --- NEW: generate taskset from word list ---
router.post("/generate", auth, async (req, res) => {
  // unchanged
});

// --- CREATE a task set (saved) ---
router.post("/", auth, async (req, res) => {
  // unchanged
});

// ⭐ NEW: LIST task sets at "/" (what the teacher-app expects)
router.get("/", auth, async (req, res) => {
  try {
    const sets = await TaskSet.find({ owner: req.userId }).sort({
      updatedAt: -1,
    });
    res.json(sets);
  } catch (err) {
    console.error("taskset list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ⭐ OPTIONAL: GET single task set by id if your UI needs it
router.get("/:id", auth, async (req, res) => {
  try {
    const set = await TaskSet.findOne({
      _id: req.params.id,
      owner: req.userId,
    });
    if (!set) return res.status(404).json({ error: "Not found" });
    res.json(set);
  } catch (err) {
    console.error("taskset get by id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// LIST my task sets (legacy route – you can keep this if something uses it)
router.get("/mine", auth, async (req, res) => {
  const sets = await TaskSet.find({ owner: req.userId }).sort({
    updatedAt: -1,
  });
  res.json(sets);
});

// LIST public task sets
router.get("/public", async (req, res) => {
  const sets = await TaskSet.find({ isPublic: true }).sort({
    "usageStats.totalPlays": -1,
  });
  res.json(sets);
});

export default router;
