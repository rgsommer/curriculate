import express from "express";
import Task from "../models/Task.js";
import mongoose from "mongoose";

const router = express.Router();

// list all
router.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1)
    return res.status(503).json({ error: "Database not connected" });

  const tasks = await Task.find().sort({ createdAt: -1 });
  res.json(tasks);
});

// get one
router.get("/:id", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// create
router.post("/", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.status(503).json({ error: "Database not connected" });

    const task = await Task.create(req.body);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// update
router.put("/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// delete
router.delete("/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
