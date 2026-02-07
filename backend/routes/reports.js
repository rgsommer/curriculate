// backend/routes/reports.js
import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import { listReports, getReport } from "../controllers/sessionReportController.js";

const router = express.Router();

router.get("/reports", authRequired, listReports);
router.get("/reports/:id", authRequired, getReport);

export default router;
