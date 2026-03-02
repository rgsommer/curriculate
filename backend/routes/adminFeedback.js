// backend/routes/adminFeedback.js
import express from "express";
import { listFeedback } from "../controllers/adminFeedbackController.js";
import { authAny } from "../middleware/authAny.js";
import { requireAdminJson } from "../middleware/requireAdminJson.js";

const router = express.Router();

// GET /admin/feedback?limit=50
router.get("/feedback", authAny, requireAdminJson, listFeedback);

export default router;