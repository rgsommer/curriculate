// backend/routes/aiTasksets.js
import express from "express";
import jwt from "jsonwebtoken";

import { createAiTaskset } from "../controllers/mainTasksetController.js";
import { regenerateSingleTask } from "../controllers/sharedTasksetController.js";
import { requireAiQuota } from "../middleware/requirePlanFeature.js";
import User from "../models/User.js";

const router = express.Router();

/**
 * Lightweight auth for these routes.
 * If you already have middleware/authRequired.js and want to use it instead,
 * you can swap this out easily—but this file is fully self-contained.
 * Bug 2: Now also populates req.user so quota middleware can work
 */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ ok: false, error: "No token" });

  const token = h.split(" ")[1];
  if (!token) return res.status(401).json({ ok: false, error: "No token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    req.userId = payload.id;
    // Bug 2: Load user document to support quota middleware
    User.findById(req.userId).then((user) => {
      if (user) req.user = user;
      next();
    }).catch(() => {
      next(); // Continue even if user load fails, quota check will fail gracefully
    });
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

router.get("/ping", (_req, res) => res.json({ ok: true }));

/**
 * POST /api/ai/tasksets
 * Main taskset generation endpoint.
 *
 * Controller owns:
 * - prompt building (driven by shared/taskTypes.js meta)
 * - validation + fallback
 * - persistence behavior
 *
 * Bug 2: Apply AI quota enforcement middleware
 */
router.post("/", auth, requireAiQuota(1), createAiTaskset);

/**
 * POST /api/ai/tasksets/regenerate-single
 * Convenience endpoint that regenerates exactly ONE task for a type.
 * Useful for debugging + internal tools.
 */
router.post("/regenerate-single", auth, async (req, res) => {
  try {
    const b = req.body || {};
    const allowedType = String(b.allowedType || "").trim();
    if (!allowedType) {
      return res.status(400).json({ ok: false, error: "Missing allowedType" });
    }

    const task = await regenerateSingleTask({
      allowedType,
      mustHave: b.mustHave ?? null,
      subject: b.subject ?? "General",
      gradeLevel: b.gradeLevel ?? 7,
      difficulty: b.difficulty ?? "MEDIUM",
      learningGoal: b.learningGoal ?? "",
      topicLabel: b.topicLabel ?? "Regenerated",
      vocabularyLines: b.vocabularyLines ?? "",
      specialConsiderations: b.specialConsiderations ?? "",
      previousTask: b.previousTask ?? null,
      temperature: typeof b.temperature === "number" ? b.temperature : undefined,
      // NOTE: no onPrompt over HTTP
    });

    return res.json({ ok: true, task });
  } catch (err) {
    console.error("[aiTasksets/regenerate-single] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to regenerate single task",
      detail: String(err?.message || err),
    });
  }
});

export default router;
