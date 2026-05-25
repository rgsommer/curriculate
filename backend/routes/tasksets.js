// backend/routes/tasksets.js
import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import TaskSet from "../models/TaskSet.js";
import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { validateAiTask, regenerateSingleTask } from "../controllers/sharedTasksetController.js";
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
 * Read-only PREVIEW of a taskset by id (NO auth) — powers the teacher "Test
 * run" feature, which opens the student app (a separate origin without the
 * teacher's auth cookie) to play through the tasks. Returns only what the
 * renderer needs. IDs are non-enumerable ObjectIds, so this is low-risk.
 *
 * Must come BEFORE "/:id" (distinct path depth, but kept explicit).
 */
router.get("/:id/preview", async (req, res) => {
  try {
    const set = await TaskSet.findById(req.params.id).lean();
    if (!set) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({
      ok: true,
      taskset: {
        _id: String(set._id),
        name: set.name || set.title || "Taskset",
        subject: set.subject || "",
        gradeLevel: set.gradeLevel || "",
        questModeEnabled: !!set.questModeEnabled,
        tasks: Array.isArray(set.tasks) ? set.tasks : [],
      },
    });
  } catch (err) {
    console.error("GET /api/tasksets/:id/preview error:", err);
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
    let aiRepaired = 0;

    // Extract taskset metadata for AI repair context
    const tsMeta = {
      subject: doc.subject || doc.meta?.subject || "General",
      gradeLevel: doc.gradeLevel || doc.meta?.gradeLevel || 7,
      difficulty: doc.difficulty || doc.meta?.difficulty || "MEDIUM",
      learningGoal: doc.learningGoal || doc.meta?.learningGoal || "",
      topicLabel: doc.name || "Repair",
    };

    // ── Pass 1: Deterministic sanitize ──
    const sanitized = tasks.map((task, idx) => {
      if (!task || typeof task !== "object") return task;
      const raw = typeof task.toObject === "function" ? task.toObject() : { ...task };
      const type = raw.taskType || raw.type || "";
      const cleaned = sanitizeTaskShapeByType(type, raw);
      return cleaned;
    });

    // ── Pass 2: Validate everything, collect what's still broken ──
    const needsAiRepair = []; // { idx, type, task, errors }

    for (let idx = 0; idx < sanitized.length; idx++) {
      const task = sanitized[idx];
      if (!task || typeof task !== "object") continue;
      const raw = typeof tasks[idx].toObject === "function" ? tasks[idx].toObject() : { ...tasks[idx] };
      const type = task.taskType || task.type || "";
      const title = task.title || task.prompt || `Task ${idx + 1}`;

      // Validate original (for logging)
      let originalErrors = [];
      try {
        const v = validateAiTask(type, raw);
        if (!v.ok) originalErrors = v.errors || [];
      } catch (e) {
        originalErrors = [e?.message || "Validation error"];
      }

      // Validate post-sanitize
      let postErrors = [];
      try {
        const v2 = validateAiTask(type, task);
        if (!v2.ok) postErrors = v2.errors || [];
      } catch (e) {
        postErrors = [e?.message || "Post-sanitize validation error"];
      }

      const structurallyFixed = originalErrors.length > 0 && postErrors.length < originalErrors.length;

      if (originalErrors.length > 0) {
        issuesFound += originalErrors.length;
        if (structurallyFixed) issuesFixed += (originalErrors.length - postErrors.length);

        // Snapshot for logging
        const snapshot = { ...raw };
        if (snapshot.mediaUrl) snapshot.mediaUrl = "(truncated)";
        if (snapshot.passage && snapshot.passage.length > 300) {
          snapshot.passage = snapshot.passage.slice(0, 300) + "…";
        }

        diagnostics.push({
          taskIndex: idx,
          taskType: type,
          title: title.slice(0, 120),
          errors: originalErrors.slice(0, 20),
          postFixErrors: postErrors.slice(0, 20),
          fixed: structurallyFixed && postErrors.length === 0,
          aiRepaired: false,
          rawTask: snapshot,
        });

        // If still broken after sanitize, queue for AI repair
        if (postErrors.length > 0) {
          needsAiRepair.push({ idx, type, task, postErrors });
        }
      }
    }

    // ── Pass 3: AI repair for tasks still broken after sanitize ──
    // Run up to 5 AI repairs per request to avoid timeouts
    const AI_REPAIR_LIMIT = 5;
    const repairQueue = needsAiRepair.slice(0, AI_REPAIR_LIMIT);

    for (const { idx, type, task, postErrors } of repairQueue) {
      try {
        console.log(`[sanitize] AI repairing task ${idx} (${type}): ${postErrors.join("; ")}`);
        const repaired = await regenerateSingleTask({
          allowedType: type,
          subject: tsMeta.subject,
          gradeLevel: tsMeta.gradeLevel,
          difficulty: tsMeta.difficulty,
          learningGoal: tsMeta.learningGoal,
          topicLabel: tsMeta.topicLabel,
          vocabularyLines: "",
          specialConsiderations: teacherNote || "",
          previousTask: task,
          previousError: postErrors.join("; "),
          temperature: 0.5,
        });

        if (repaired && typeof repaired === "object") {
          // Preserve original title/prompt if AI didn't improve them
          if (!repaired.title && task.title) repaired.title = task.title;
          sanitized[idx] = repaired;
          aiRepaired++;

          // Update the diagnostic entry
          const diagEntry = diagnostics.find((d) => d.taskIndex === idx);
          if (diagEntry) {
            diagEntry.aiRepaired = true;
            diagEntry.fixed = true;
            diagEntry.postFixErrors = [];
          }
        }
      } catch (aiErr) {
        console.error(`[sanitize] AI repair failed for task ${idx}:`, aiErr?.message);
        // Update diagnostic to note AI repair was attempted but failed
        const diagEntry = diagnostics.find((d) => d.taskIndex === idx);
        if (diagEntry) {
          diagEntry.aiRepairError = aiErr?.message || "AI repair failed";
        }
      }
    }

    // ── Save ──
    doc.tasks = sanitized;
    doc.updatedAt = new Date();
    await doc.save();

    // ── Log (MongoDB + local JSONL) ──
    let logId = null;
    const logEntry = {
      ts: new Date().toISOString(),
      tasksetId: String(doc._id),
      tasksetName: doc.name || "",
      teacherNote,
      totalTasks: tasks.length,
      issuesFound,
      issuesFixed,
      aiRepaired,
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

    try {
      fs.appendFileSync(DIAG_LOG_PATH, JSON.stringify(logEntry) + "\n");
    } catch (fileErr) {
      console.error("Failed to write diagnostic-logs.jsonl:", fileErr?.message);
    }

    // ── Response ──
    const totalFixed = issuesFixed + aiRepaired;
    let message;
    if (issuesFound === 0) {
      message = `All ${tasks.length} tasks passed validation.`;
    } else if (totalFixed > 0 && needsAiRepair.length === aiRepaired) {
      message = `Found ${issuesFound} issue(s). All fixed (${issuesFixed} structural, ${aiRepaired} AI-repaired).`;
    } else if (totalFixed > 0) {
      const remaining = diagnostics.filter((d) => !d.fixed).length;
      message = `Found ${issuesFound} issue(s). Fixed ${totalFixed} (${issuesFixed} structural, ${aiRepaired} AI-repaired). ${remaining} task(s) still need attention.`;
    } else {
      message = `Found ${issuesFound} issue(s) across ${diagnostics.length} task(s). Could not auto-fix — logged for developer review.`;
    }

    return res.json({
      ok: true,
      taskCount: tasks.length,
      issuesFound,
      issuesFixed,
      aiRepaired,
      diagnostics,
      logId,
      message,
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

/**
 * Clear all diagnostic logs (after developer has processed them).
 * DELETE /api/tasksets/diagnostics/logs
 */
router.delete("/diagnostics/logs", auth, async (req, res) => {
  try {
    const result = await TaskDiagnosticLog.deleteMany({});
    // Also clear the local JSONL file
    try {
      fs.writeFileSync(DIAG_LOG_PATH, "");
    } catch {}
    return res.json({ ok: true, deleted: result.deletedCount || 0 });
  } catch (err) {
    console.error("DELETE /api/tasksets/diagnostics/logs error:", err);
    return res.status(500).json({ ok: false, error: "Failed to clear logs" });
  }
});

export default router;
