// backend/routes/feedback.js
import express from "express";
import { createFeedback } from "../controllers/feedbackController.js";

const router = express.Router();
router.post("/", createFeedback);

export default router;