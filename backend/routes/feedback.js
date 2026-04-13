// backend/routes/feedback.js
import express from "express";
import { createFeedback, createStudentFeedback } from "../controllers/feedbackController.js";

const router = express.Router();
router.post("/", createFeedback);
router.post("/student", createStudentFeedback);

export default router;