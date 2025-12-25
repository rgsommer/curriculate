// backend/routes/demoTasksetStream.js
import express from "express";
import { streamDemoTaskset } from "../controllers/demoTasksetStreamController.js";

const router = express.Router();

/**
 * Streaming (SSE) endpoint for demo taskset generation progress.
 * Mounted at: /api/demo
 * Full path: /api/demo/taskset/stream
 */
router.get("/taskset/stream", streamDemoTaskset);

export default router;
