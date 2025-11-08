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
