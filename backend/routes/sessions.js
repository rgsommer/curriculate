// backend/routes/sessions.js
import express from "express";

const router = express.Router();

/**
 * Placeholder Sessions API
 * 
 * This exists ONLY so that:
 *   import sessionsRouter from "./routes/sessions.js";
 *   app.use("/sessions", sessionsRouter);
 * does not break.
 *
 * You can expand this later:
 *   - create sessions
 *   - list sessions
 *   - fetch stored submissions
 *   - link sessions with QR stations
 */

// GET /sessions
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Sessions API placeholder. No session features enabled yet.",
  });
});

// GET /sessions/:id
router.get("/:id", (req, res) => {
  res.json({
    status: "ok",
    message: `Placeholder session endpoint for ID: ${req.params.id}`,
  });
});

export default router;
