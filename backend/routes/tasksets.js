// backend/routes/tasksets.js
import express from "express";
import TaskSet from "../models/TaskSet.js";
import jwt from "jsonwebtoken";

const router = express.Router();

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });
  const token = h.split(" ")[1];
  const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
  req.userId = payload.id;
  next();
}

// Enforce plan limits
const owner = await User.findById(req.userId);
if (owner.plan.tier === "free") {
  const start = new Date();
  start.setDate(1); // beginning of month
  const createdThisMonth = await TaskSet.countDocuments({
    owner: req.userId,
    createdAt: { $gte: start },
  });
  if (createdThisMonth >= owner.plan.taskLimitPerMonth) {
    return res.status(403).json({ error: "Plan limit reached" });
  }
  if (req.body.tasks.length > owner.plan.questionLimitPerSet) {
    return res.status(403).json({ error: "Too many questions for free plan" });
  }
}

// create from JSON (UI)
router.post("/", auth, async (req, res) => {
  const ts = await TaskSet.create({
    owner: req.userId,
    title: req.body.title,
    description: req.body.description,
    tasks: req.body.tasks,
    isPublic: req.body.isPublic || false
  });
  res.json(ts);
});

// list mine
router.get("/mine", auth, async (req, res) => {
  const sets = await TaskSet.find({ owner: req.userId }).sort({ updatedAt: -1 });
  res.json(sets);
});

// public library
router.get("/public", async (req, res) => {
  const sets = await TaskSet.find({ isPublic: true }).sort({ "usageStats.totalPlays": -1 });
  res.json(sets);
});

export default router;
