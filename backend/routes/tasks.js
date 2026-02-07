// backend/routes/tasks.js
import express from "express";

const router = express.Router();

/**
 * Simple placeholder Tasks API.
 *
 * Right now, this exists mainly so that:
 *   import tasksRouter from "./routes/tasks.js";
 *   app.use("/tasks", tasksRouter);
 * in index.js does not break.
 *
 * You can expand this later to:
 *  - return tasks from a TaskSet
 *  - validate task data
 *  - provide per-task CRUD if needed
 */

// GET /tasks
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Tasks API placeholder. No task endpoints implemented yet.",
  });
});

export default router;
