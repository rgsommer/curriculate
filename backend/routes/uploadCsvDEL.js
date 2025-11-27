import express from "express";
import Papa from "papaparse";
import TaskSet from "../models/TaskSet.js";

const router = express.Router();

router.post("/from-csv", async (req, res) => {
  try {
    const { csvText, name, ownerId } = req.body;
    if (!csvText) return res.status(400).json({ error: "csvText required" });

    // parse CSV
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const tasks = parsed.data.map((row, idx) => {
      const taskType = (row.task_type || "").trim();
      const options =
        row.options && typeof row.options === "string"
          ? row.options.split("|").map((s) => s.trim()).filter(Boolean)
          : [];

      // normalize answer depending on type
      let answer = row.answer;
      if (taskType === "sequence" && typeof answer === "string") {
        answer = answer.split(">").map((s) => s.trim());
      }

      return {
        taskId: row.task_id || `task_${idx + 1}`,
        title: row.title || `Task ${idx + 1}`,
        prompt: row.prompt?.trim(),
        taskType,
        options,
        answer,
        mediaUrl: row.media_url?.trim() || null,
        timeLimitSeconds: row.time_limit_seconds
          ? Number(row.time_limit_seconds)
          : null,
        points: row.points ? Number(row.points) : 10,
      };
    });

    const taskset = await TaskSet.create({
      name: name || "Uploaded Task Set",
      ownerId: ownerId || null,
      tasks,
    });

    res.json({ ok: true, tasksetId: taskset._id });
  } catch (err) {
    console.error("CSV upload failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
