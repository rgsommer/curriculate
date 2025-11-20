// backend/routes/tasksetRoutes.js
import express from "express";
import {
  createTaskSet,
  getAllTaskSets,
  getTaskSetById,
  updateTaskSet,
  deleteTaskSet,
} from "../controllers/tasksetController.js";
//import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();

//router.get("/", authRequired, getAllTaskSets);
//router.get("/:id", authRequired, getTaskSetById);
//router.post("/", authRequired, createTaskSet);
//router.put("/:id", authRequired, updateTaskSet);
//router.delete("/:id", authRequired, deleteTaskSet);

// DEV / single-teacher mode: no authRequired yet
router.get("/", getAllTaskSets);
router.get("/:id", getTaskSetById);
router.post("/", createTaskSet);
router.put("/:id", updateTaskSet);
router.delete("/:id", deleteTaskSet);

// IMPORTANT: ES module default export
export default router;
