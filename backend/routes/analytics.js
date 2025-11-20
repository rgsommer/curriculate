// backend/routes/analytics.js
import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requirePlan } from "../middleware/requirePlan.js";
import {
  listSessions,
  getSessionDetails,
} from "../controllers/analyticsController.js";

const router = express.Router();

// PLUS or PRO required for analytics
router.get(
  "/sessions",
  authRequired,
  requirePlan("PLUS"),
  listSessions
);

router.get(
  "/sessions/:id",
  authRequired,
  requirePlan("PLUS"),
  getSessionDetails
);

export default router;
