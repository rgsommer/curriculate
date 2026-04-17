// backend/routes/tasksets.js
import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import TaskSet from "../models/TaskSet.js";
import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { validateAiTask } from "../controllers/sharedTasksetController.js";
import TaskDiagnosticLog from "../models/TaskDiagnosticLog.js";
import { TASK_TYPES } from "../../shared/taskTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIAG_LOG_PATH = path.resolve(__dirname, "../../diagnostic-logs.jsonl");

const router = express.Router();

/**
 * Self-contained auth middleware.
 * If you prefer your shared authRequired middleware, swap it in here.
 */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ ok: false, error: "No token" });

  const token = h.split(" ")[1];
  if (!token) return res.status(401).json({ ok: false, error: "No token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

/**
 * Helper: query that includes either:
 * - sets owned by this user
 * - OR sets that have no owner field (legacy)
 */
function ownedOrLegacyQuery(userId) {
  return {
    $or: [{ owner: userId }, { owner: { $exists: false } }, { owner: null }],
  };
}

/**
 * Create a task set (manual save endpoint).
 * POST /api/tasksets
 */
router.post("/", auth, async (req, res) => {
  try {
    const b = req.body || {};
    const now = new Date();

    const doc = await TaskSet.create({
      ...b,
      owner: b.owner ?? req.userId, // prefer explicit if caller passes, else set to user
      createdAt: b.createdAt ?? now,
      updatedAt: now,
    });

    return res.status(201).json({ ok: true, taskset: doc });
  } catch (err) {
    console.error("POST /api/tasksets error:", err);
    return res.status(500).json({ ok: false, error: "Failed to create task set" });
  }
});

/**
 * List tasksets (what the teacher-app expects).
 * GET /api/tasksets
 */
router.get("/", auth, async (req, res) => {
  try {
    const sets = await TaskSet.find(ownedOrLegacyQuery(req.userId))
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ ok: true, tasksets: sets });
  } catch (err) {
    console.error("GET /api/tasksets error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Legacy "mine" route (keep if something uses it).
 * GET /api/tasksets/mine
 *
 * IMPORTANT: this must come BEFORE "/:id"
 */
router.get("/mine", auth, async (req, res) => {
  try {
    const sets = await TaskSet.find(ownedOrLegacyQuery(req.userId))
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ ok: true, tasksets: sets });
  } catch (err) {
    console.error("GET /api/tasksets/mine error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Public gallery
 * GET /api/tasksets/public
 *
 * IMPORTANT: this must come BEFORE "/:id"
 */
router.get("/public", async (req, res) => {
  try {
    const sets = await TaskSet.find({ isPublic: true })
      .sort({ "usageStats.totalPlays": -1, updatedAt: -1 })
      .lean();

    return res.json({ ok: true, tasksets: sets });
  } catch (err) {
    console.error("GET /api/tasksets/public error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Get a single taskset by id
 * GET /api/tasksets/:id
 */
router.get("/:id", auth, async (req, res) => {
  try {
    const set = await TaskSet.findOne({
      _id: req.params.id,
      ...ownedOrLegacyQuery(req.userId),
    }).lean();

    if (!set) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, taskset: set });
  } catch (err) {
    console.error("GET /api/tasksets/:id error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Update a taskset
 * PUT /api/tasksets/:id
 */
router.put("/:id", auth, async (req, res) => {
  try {
    const b = req.body || {};
    const updated = await TaskSet.findOneAndUpdate(
      { _id: req.params.id, ...ownedOrLegacyQuery(req.userId) },
      { $set: { ...b, updatedAt: new Date() } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, taskset: updated });
  } catch (err) {
    console.error("PUT /api/tasksets/:id error:", err);
    return res.status(500).json({ ok: false, error: "Failed to update task set" });
  }
});

/**
 * Delete a taskset
 * DELETE /api/tasksets/:id
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const deleted = await TaskSet.findOneAndDelete({
      _id: req.params.id,
      ...ownedOrLegacyQuery(req.userId),
    });

    if (!deleted) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasksets/:id error:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete task set" });
  }
});

/**
 * Diagnose + sanitize all tasks in a taskset.
 * Validates each task, fixes what it can, and logs a diagnostic report.
 * POST /api/tasksets/:id/sanitize
 * Body (optional): { note: "teacher's description of what's wrong" }
 */
router.post("/:id/sanitize", auth, async (req, res) => {
  try {
    const doc = await TaskSet.findOne({
      _id: req.params.id,
      ...ownedOrLegacyQuery(req.userId),
    });

    if (!doc) return res.status(404).json({ ok: false, error: "Not found" });

    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    const teacherNote = String(req.body?.note || "").trim().slice(0, 1000);
    const diagnostics = [];
    let issuesFound = 0;
    let issuesFixed = 0;

    const sanitized = tasks.map((task, idx) => {
      if (!task || typeof task !== "object") return task;
      const raw = typeof task.toObject === "function" ? task.toObject() : { ...task };
      const type = raw.taskType || raw.type || "";
      const title = raw.title || raw.prompt || `Task ${idx + 1}`;

      // Step 1: Validate BEFORE sanitizing to capture original errors
      let errors = [];
      try {
        const v = validateAiTask(type, raw);
        if (!v.ok) errors = v.errors || [];
      } catch (e) {
        errors = [e?.message || "Validation threw an error"];
      }

      // Step 2: Sanitize
      const cleaned = sanitizeTaskShapeByType(type, raw);
      const wasChanged = JSON.stringify(cleaned) !== JSON.stringify(raw);

      // Step 3: Validate AFTER sanitizing to see what's still broken
      let postErrors = [];
      try {
        const v2 = validateAiTask(type, cleaned);
        if (!v2.ok) postErrors = v2.errors || [];
      } catch (e) {
        postErrors = [e?.message || "Post-sanitize validation threw"];
      }

      const fixed = wasChanged && postErrors.length < errors.length;

      if (errors.length > 0) {
        issuesFound += errors.length;
        if (fixed) issuesFixed += (errors.length - postErrors.length);
        diagnostics.push({
          taskIndex: idx,
          taskType: type,
          title: title.slice(0, 120),
          errors: errors.slice(0, 20),
          fixed,
        });
      }

      return cleaned;
    });

    // Save fixed tasks
    doc.tasks = sanitized;
    doc.updatedAt = new Date();
    await doc.save();

    // Write diagnostic log (MongoDB + local JSONL file)
    let logId = null;
    const logEntry = {
      ts: new Date().toISOString(),
      tasksetId: String(doc._id),
      tasksetName: doc.name || "",
      teacherNote,
      totalTasks: tasks.length,
      issuesFound,
      issuesFixed,
      diagnostics,
    };

    try {
      const log = await TaskDiagnosticLog.create({
        ...logEntry,
        triggeredBy: "teacher",
      });
      logId = String(log._id);
    } catch (logErr) {
      console.error("Failed to write diagnostic log to DB:", logErr?.message);
    }

    // Append to local file so developer can read it directly
    try {
      fs.appendFileSync(DIAG_LOG_PATH, JSON.stringify(logEntry) + "\n");
    } catch (fileErr) {
      console.error("Failed to write diagnostic-logs.jsonl:", fileErr?.message);
    }

    return res.json({
      ok: true,
      taskCount: tasks.length,
      issuesFound,
      issuesFixed,
      diagnostics,
      logId,
      message: issuesFound === 0
        ? `All ${tasks.length} tasks passed validation.`
        : issuesFixed > 0
          ? `Found ${issuesFound} issue(s) across ${diagnostics.length} task(s). Auto-fixed ${issuesFixed}.`
          : `Found ${issuesFound} issue(s) across ${diagnostics.length} task(s). Could not auto-fix — may need AI regeneration.`,
    });
  } catch (err) {
    console.error("POST /api/tasksets/:id/sanitize error:", err);
    return res.status(500).json({ ok: false, error: "Failed to sanitize" });
  }
});

/**
 * List diagnostic logs (for developer review).
 * GET /api/tasksets/diagnostics/logs?limit=20&skip=0
 */
router.get("/diagnostics/logs", auth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = Math.max(0, Number(req.query.skip) || 0);

    const logs = await TaskDiagnosticLog.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({ ok: true, logs });
  } catch (err) {
    console.error("GET /api/tasksets/diagnostics/logs error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load logs" });
  }
});

export default router;
