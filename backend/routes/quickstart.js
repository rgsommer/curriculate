// backend/routes/quickstart.js
//
// Read-only HTTP endpoints for the Quick Start onboarding flow.
// The actual launch goes through the existing socket flow (a teacher
// creates a room, then emits teacher:loadQuickstart with the preset key).
// This route just lets the picker page list available presets and fetch
// a single preset's metadata for the confirmation step.

import express from "express";
import {
  listQuickstartTasksetsByBand,
  getQuickstartTaskset,
  QUICKSTART_KEYS,
} from "../../shared/quickstartTasksets.js";

const router = express.Router();

/**
 * GET /api/quickstart
 * Returns presets grouped by grade band. Used to render the picker grid.
 * Tasks are NOT included — only metadata. Keeps the payload small and
 * stops the picker page from leaking the answer keys.
 */
router.get("/", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    ok: true,
    byBand: listQuickstartTasksetsByBand(),
    keys: QUICKSTART_KEYS,
  });
});

/**
 * GET /api/quickstart/:key
 * Returns a single preset's metadata for the confirmation step.
 * Still no tasks — those are attached server-side at launch time.
 */
router.get("/:key", (req, res) => {
  const preset = getQuickstartTaskset(req.params.key);
  if (!preset) {
    return res.status(404).json({ ok: false, error: "Unknown preset" });
  }
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    ok: true,
    preset: {
      key: preset.key,
      title: preset.title,
      subject: preset.subject,
      gradeBand: preset.gradeBand,
      gradeLevel: preset.gradeLevel,
      topic: preset.topic,
      summary: preset.summary,
      estimatedMinutes: preset.estimatedMinutes,
      taskCount: Array.isArray(preset.tasks) ? preset.tasks.length : 0,
      taskTypes: (preset.tasks || []).map((t) => t?.taskType),
    },
  });
});

export default router;
