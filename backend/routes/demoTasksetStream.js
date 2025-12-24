// backend/routes/demoTasksetStream.js
import express from "express";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";
import { generateDemoTasksetStreaming } from "../controllers/demoTasksetStreamController.js";

const router = express.Router();

// GET /api/demo/taskset/stream?payload=<urlencoded json>
router.get("/taskset/stream", generateDemoTasksetStreaming);

export default router;
