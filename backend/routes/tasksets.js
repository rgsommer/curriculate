import express from "express";
import Task from "../models/Task.js";

const router = express.Router();

// create a whole set of tasks at once
router.post("/generate", async (req, res) => {
  const { stationCount = 8, linear = false, subject = "general" } = req.body;

  try {
    const tasks = [];

    for (let i = 1; i <= stationCount; i++) {
      tasks.push({
        title: `Station ${i}`,
        description: `Auto-generated station ${i} for ${subject}`,
        points: 5,
        stationNumber: i,
        isLinear: linear,
        subject,
      });
    }

    const created = await Task.insertMany(tasks);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
