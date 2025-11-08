// backend/routes/admin.js
import express from "express";
import TaskSet from "../models/TaskSet.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";

const router = express.Router();

function admin(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });
  const token = h.split(" ")[1];
  const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
  if (payload.role !== "admin") return res.status(403).json({ error: "Not admin" });
  req.userId = payload.id;
  next();
}

router.get("/metrics", admin, async (req, res) => {
  const users = await User.countDocuments();
  const publicSets = await TaskSet.countDocuments({ isPublic: true });
  const totalSets = await TaskSet.countDocuments();
  res.json({ users, publicSets, totalSets });
});

export default router;
