// backend/routes/shared.js
import express from "express";
import { sharedLaunchController } from "../controllers/sharedController.js";

const router = express.Router();

/**
 * Public: click link -> get guest presenter token + fresh room code + taskset meta
 * POST /api/shared/:token/launch
 */
router.post("/:token/launch", sharedLaunchController);

export default router;
