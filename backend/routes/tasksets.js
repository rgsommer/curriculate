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

// CREATE a task set
router.post("/", auth, async (req, res) => {
  try {
    // 1) load the owner
    const owner = await User.findById(req.userId);

    // 2) enforce plan limits (FREE plan example)
    if (owner?.plan?.tier === "free") {
      // how many sets this month?
      const start = new Date();
      start.setDate(1);
      const createdThisMonth = await TaskSet.countDocuments({
        owner: req.userId,
        createdAt: { $gte: start },
      });

      if (createdThisMonth >= (owner.plan.taskLimitPerMonth || 1)) {
        return res.status(403).json({ error: "Plan limit reached" });
      }

      // check question count
      const incomingTasks = req.body.tasks || [];
      if (
        incomingTasks.length >
        (owner.plan.questionLimitPerSet || 10)
      ) {
        return res.status(403).json({ error: "Too many questions for free plan" });
      }
    }

    // 3) actually create the task set
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
  const sets = await TaskSet.find({ owner: req.userId }).sort({ updatedAt: -1 });
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
