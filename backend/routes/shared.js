// backend/routes/shared.js
import express from "express";
import { sharedLaunchController, createShareLinkController } from "../controllers/sharedController.js";
import { authAny } from "../middleware/authAny.js";

const router = express.Router();

/**
 * Authenticated: create a shareable link for a taskset
 * POST /api/shared/create-link
 *
 * NOTE: More specific route MUST come before the generic :token route
 * to prevent "create-link" from matching the :token parameter pattern
 */
router.post("/create-link", authAny, createShareLinkController);

/**
 * Public: click link -> get guest presenter token + fresh room code + taskset meta
 * POST /api/shared/:token/launch
 *
 * This is less specific and should come after /create-link
 */
router.post("/:token/launch", sharedLaunchController);

export default router;
