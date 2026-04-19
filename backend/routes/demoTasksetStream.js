// backend/routes/demoTasksetStream.js
import express from "express";
import {
  getDemoTaskset,
  getDemoTasksetStatus,
  streamDemoTaskset,
} from "../controllers/demoTasksetController.js";

import { authAny } from "../middleware/authAny.js";
import { requireAdminJson } from "../middleware/requireAdminJson.js";

const router = express.Router();

// Public list used by www.curriculate.net/demo
router.get("/task-types", (req, res) => {
  // TODO: replace with your real registry source
  res.json({ taskTypes: [] });
});

// Fetch the currently-saved demo taskset (public — used by student demo app)
router.get("/taskset", getDemoTaskset);

// Simple JSON status endpoint (source of truth for "Last generated")
router.get("/taskset/status", authAny, requireAdminJson, getDemoTasksetStatus);

/**
 * Streaming (SSE) endpoint for demo taskset generation progress.
 * Mounted at: /api/demo
 * Full path: /api/demo/taskset/stream
 */
router.get("/taskset/stream", authAny, requireAdminJson, streamDemoTaskset);

export default router;