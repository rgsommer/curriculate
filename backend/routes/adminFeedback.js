// backend/routes/adminFeedback.js
import express from "express";
import { listFeedback } from "../controllers/adminFeedbackController.js";
import { requireAdminToken } from "../middleware/requireAdminToken.js";

const router = express.Router();

// mounted at /admin, so this becomes GET /admin/feedback
router.get("/feedback", requireAdminToken, listFeedback);

export default router;