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

function getTasksetLimitsForTier(subscriptionTier = "FREE") {
  const tier = (subscriptionTier || "FREE").toUpperCase();
  if (tier === "FREE") {
    return { taskLimitPerMonth: 1, questionLimitPerSet: 10 };
  }
  if (tier === "PLUS") {
    return { taskLimitPerMonth: 50, questionLimitPerSet: 50 };
  }
  // PRO – effectively high / “unlimited”
  return { taskLimitPerMonth: 9999, questionLimitPerSet: 200 };
}

function getWordLimitForTier(subscriptionTier = "FREE") {
  const tier = (subscriptionTier || "FREE").toUpperCase();
  if (tier === "FREE") return 12;
  if (tier === "PLUS") return 75;
  return 1000; // PRO
}

// --- NEW: generate taskset from word list ---
router.post("/generate", auth, async (req, res) => {
  try {
    const owner = await User.findById(req.userId);
    if (!owner) return res.status(401).json({ error: "User not found" });

    const subscriptionTier = owner.subscriptionTier || "FREE";
    const wordLimit = getWordLimitForTier(subscriptionTier);

    const words = Array.isArray(req.body.words) ? req.body.words : [];
    if (!words.length) {
      return res.status(400).json({ error: "No words provided" });
    }

    if (words.length > wordLimit) {
      return res.status(403).json({
        error: `Your plan (${subscriptionTier}) allows up to ${wordLimit} words per generation.`,
      });
    }

    const name = req.body.name || "Untitled Taskset";
    const types = req.body.types || {}; // { mc: true, tf: true, ... }

    // TODO: replace this stub with real AI generation.
    const tasks = words.map((w, idx) => ({
      type: "short-answer",
      prompt: `Briefly explain: ${w}`,
      config: {
        acceptable: [w.toLowerCase()],
      },
      order: idx,
    }));

    return res.json({
      ok: true,
      taskset: { name, tasks },
    });
  } catch (err) {
    console.error("taskset generate error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// --- CREATE a task set (saved) ---
router.post("/", auth, async (req, res) => {
  try {
    const owner = await User.findById(req.userId);
    if (!owner) return res.status(401).json({ error: "User not found" });

    const subscriptionTier = owner.subscriptionTier || "FREE";
    const { taskLimitPerMonth, questionLimitPerSet } =
      getTasksetLimitsForTier(subscriptionTier);

    // Only enforce per-month and per-set limits for FREE
    if (subscriptionTier === "FREE") {
      const start = new Date();
      start.setDate(1);

      const createdThisMonth = await TaskSet.countDocuments({
        owner: req.userId,
        createdAt: { $gte: start },
      });

      if (createdThisMonth >= taskLimitPerMonth) {
        return res.status(403).json({ error: "Plan limit reached" });
      }

      const incomingTasks = req.body.tasks || [];
      if (incomingTasks.length > questionLimitPerSet) {
        return res
          .status(403)
          .json({ error: "Too many questions for FREE plan" });
      }
    }

    const ts = await TaskSet.create({
      owner: req.userId,
      title: req.body.title,
      description: req.body.description,
      tasks: req.body.tasks || [],
      isPublic: req.body.isPublic || false,
    });

    return res.json(ts);
  } catch (err) {
    console.error("taskset create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// LIST my task sets
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
