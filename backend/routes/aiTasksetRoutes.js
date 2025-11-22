// backend/routes/aiTasksetRoutes.js

import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import UserSubscription from "../models/UserSubscription.js";
import SubscriptionPlan from "../models/SubscriptionPlan.js";
import { createAiTasks } from "../ai/createAiTasks.js";

const router = express.Router();

/**
 * POST /api/ai/tasksets
 *
 * Body (example):
 * {
 *   "subject": "History 7 – New France",
 *   "plan": [ { concept, taskType, reason? }, ... ],
 *   "context": {
 *      "gradeLevel": "Grade 7",
 *      "difficulty": "MEDIUM",
 *      "learningGoal": "REVIEW",
 *      "durationMinutes": 45,
 *      "topicTitle": "The Acadian Expulsion"
 *   }
 * }
 *
 * Response on success:
 * {
 *   "tasks": [...],
 *   "subscription": {
 *     "planName": "FREE",
 *     "aiTaskSetsUsedThisPeriod": 1,
 *     "aiTaskSetsLimit": 1,
 *     "aiTaskSetsRemaining": 0,
 *     "aiLimitTeaser": "..."
 *   }
 * }
 *
 * Response when limit hit (e.g. FREE over 1):
 * 403 + {
 *   "error": "AI_LIMIT_REACHED",
 *   "message": "You’ve used your 1 AI task set for this month on the Free plan. Upgrade to PLUS or PRO for more AI-generated task sets and richer reporting."
 * }
 */
router.post("/", authRequired, async (req, res) => {
  try {
    const userId = req.user._id;
    const { subject, plan, context = {} } = req.body || {};

    if (!Array.isArray(plan) || plan.length === 0) {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Missing or empty 'plan' array for AI task creation.",
      });
    }

    // ------------------------------------------------------------
    // Load or create subscription
    // ------------------------------------------------------------
    let sub = await UserSubscription.findOne({ userId });

    if (!sub) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      sub = await UserSubscription.create({
        userId,
        planName: "FREE",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        aiGenerationsUsedThisPeriod: 0,
      });
    }

    const planName = sub.planName || "FREE";
    const planDoc = await SubscriptionPlan.findOne({ name: planName });
    const features = planDoc?.features || {};

    const defaultLimit =
      features.aiTaskSetsPerMonth ??
      (planName === "FREE" ? 1 : planName === "PLUS" ? 50 : 9999);

    const used = sub.aiGenerationsUsedThisPeriod || 0;
    const remaining = Math.max(0, defaultLimit - used);

    // ------------------------------------------------------------
    // ENFORCE LIMIT
    // ------------------------------------------------------------
    if (remaining <= 0) {
      // Same language as subscriptionRoutes teaser
      let message =
        "You’ve used your AI task sets for this billing period.";

      if (planName === "FREE") {
        message =
          "You’ve used your 1 AI task set for this month on the Free plan. Upgrade to PLUS or PRO for more AI-generated task sets and richer reporting.";
      } else if (planName === "PLUS") {
        message =
          "You’ve used all your AI task sets for this billing period. PRO increases your AI limits and unlocks deeper analytics.";
      }

      return res.status(403).json({
        error: "AI_LIMIT_REACHED",
        message,
        subscription: {
          planName,
          aiTaskSetsUsedThisPeriod: used,
          aiTaskSetsLimit: defaultLimit,
          aiTaskSetsRemaining: 0,
        },
      });
    }

    // ------------------------------------------------------------
    // CALL AI TASK CREATOR
    // ------------------------------------------------------------
    const tasks = await createAiTasks(subject, plan, context);

    // Increment usage after successful generation
    sub.aiGenerationsUsedThisPeriod = used + 1;
    await sub.save();

    const newRemaining = Math.max(0, defaultLimit - (used + 1));
    let aiLimitTeaser = "";

    if (newRemaining <= 0 && planName === "FREE") {
      aiLimitTeaser =
        "You’ve used your 1 AI task set for this month on the Free plan. Upgrade to PLUS or PRO for more AI-generated task sets and richer reporting.";
    } else if (newRemaining <= 0 && planName === "PLUS") {
      aiLimitTeaser =
        "You’ve used all your AI task sets for this billing period. PRO increases your AI limits and unlocks deeper analytics.";
    }

    return res.json({
      tasks,
      subscription: {
        planName,
        aiTaskSetsUsedThisPeriod: used + 1,
        aiTaskSetsLimit: defaultLimit,
        aiTaskSetsRemaining: newRemaining,
        aiLimitTeaser,
      },
    });
  } catch (err) {
    console.error("[aiTasksetRoutes] Error creating AI tasks", err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "Failed to generate AI tasks.",
    });
  }
});

export default router;
