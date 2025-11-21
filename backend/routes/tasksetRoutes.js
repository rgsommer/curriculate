// backend/routes/tasksetRoutes.js
import express from "express";
import {
  getAllTaskSets,
  getTaskSetById,
  createTaskSet,
  updateTaskSet,
  deleteTaskSet,
} from "../controllers/tasksetController.js";

const router = express.Router();

/**
 * GET /api/tasksets
 * Returns all task sets (currently no auth, so this will return all TaskSets;
 * later you can filter by owner from req.user).
 */
router.get("/", getAllTaskSets);

/**
 * GET /api/tasksets/:id
 * Returns a single task set by id.
 */
router.get("/:id", getTaskSetById);

/**
 * POST /api/tasksets
 * Creates a new task set.
 */
router.post("/", createTaskSet);

/**
 * PUT /api/tasksets/:id
 * Updates an existing task set.
 */
router.put("/:id", updateTaskSet);

/**
 * DELETE /api/tasksets/:id
 * Deletes a task set.
 */
router.delete("/:id", deleteTaskSet);

export default router;
