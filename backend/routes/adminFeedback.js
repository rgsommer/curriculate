// backend/routes/adminFeedback.js
import express from "express";
import { listFeedback, archiveFeedback, restoreFeedback, deleteFeedback } from "../controllers/adminFeedbackController.js";
import { requireAdminToken } from "../middleware/requireAdminToken.js";
import TaskDiagnosticLog from "../models/TaskDiagnosticLog.js";

const router = express.Router();

// mounted at /admin, so this becomes GET /admin/feedback
router.get("/feedback", requireAdminToken, listFeedback);
router.patch("/feedback/:id/archive", requireAdminToken, archiveFeedback);
router.patch("/feedback/:id/restore", requireAdminToken, restoreFeedback);
router.delete("/feedback/:id", requireAdminToken, deleteFeedback);

// Diagnostic logs — accessible from admin panel
router.get("/diagnostics", requireAdminToken, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const logs = await TaskDiagnosticLog.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json({ ok: true, logs });
  } catch (e) {
    console.error("GET /admin/diagnostics error:", e);
    res.status(500).json({ error: "Failed to load diagnostic logs" });
  }
});

router.delete("/diagnostics", requireAdminToken, async (req, res) => {
  try {
    const result = await TaskDiagnosticLog.deleteMany({});
    res.json({ ok: true, deleted: result.deletedCount || 0 });
  } catch (e) {
    console.error("DELETE /admin/diagnostics error:", e);
    res.status(500).json({ error: "Failed to clear diagnostic logs" });
  }
});

export default router;