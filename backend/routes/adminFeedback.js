// backend/routes/adminFeedback.js
import express from "express";
import { listFeedback, archiveFeedback, restoreFeedback, deleteFeedback } from "../controllers/adminFeedbackController.js";
import { requireAdminToken } from "../middleware/requireAdminToken.js";

const router = express.Router();

// mounted at /admin, so this becomes GET /admin/feedback
router.get("/feedback", requireAdminToken, listFeedback);
router.patch("/feedback/:id/archive", requireAdminToken, archiveFeedback);
router.patch("/feedback/:id/restore", requireAdminToken, restoreFeedback);
router.delete("/feedback/:id", requireAdminToken, deleteFeedback);

export default router;