// backend/routes/subscriptionRoutes.js
import express from "express";
import SubscriptionPlan from "../models/SubscriptionPlan.js";
import UserSubscription from "../models/UserSubscription.js";
import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();

/**
 * GET /api/subscription/me
 *
 * Returns:
 *  - planName
 *  - currentPeriodStart / End
 *  - aiGenerationsUsedThisPeriod (backwards compatible)
 *  - aiTaskSetsUsedThisPeriod
 *  - aiTaskSetsLimit
 *  - aiTaskSetsRemaining
 *  - aiLimitTeaser (for UI to show "you've used your 1 AI task set..." etc.)
 *  - features: { maxTasksPerSet, maxWordListWords, aiTaskSetsPerMonth, ... }
 */
router.get("/me", authRequired, async (req, res) => {
  try {
    const userId = req.user._id;

    let sub = await UserSubscription.findOne({ userId });

    if (!sub) {
      // Auto-create FREE if needed
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
    const plan = await SubscriptionPlan.findOne({ name: planName });
    const planFeatures = plan?.features || {};

    // --- Limits ----------------------------------------------------
    // FREE: 1 AI task set / month, up to 5 tasks, up to 10 words
    // PLUS / PRO: can be overridden via SubscriptionPlan.features
    const defaultMaxTasksPerSet =
      planFeatures.maxTasksPerSet ??
      (planName === "FREE" ? 5 : planName === "PLUS" ? 20 : 50);
    const defaultMaxWordListWords =
      planFeatures.maxWordListWords ??
      (planName === "FREE" ? 10 : planName === "PLUS" ? 100 : 9999);
    const defaultAiTaskSetsPerMonth =
      planFeatures.aiTaskSetsPerMonth ??
      (planName === "FREE" ? 1 : planName === "PLUS" ? 50 : 9999);

    const used = sub.aiGenerationsUsedThisPeriod || 0;
    const limit = defaultAiTaskSetsPerMonth;
    const remaining = Math.max(0, limit - used);

    let aiLimitTeaser = "";
    if (remaining <= 0 && planName === "FREE") {
      aiLimitTeaser =
        "You’ve used your 1 AI task set for this month on the Free plan. Upgrade to PLUS or PRO for more AI-generated task sets and richer reporting.";
    } else if (remaining <= 0 && planName === "PLUS") {
      aiLimitTeaser =
        "You’ve used all your AI task sets for this billing period. PRO increases your AI limits and unlocks deeper analytics.";
    }

    const features = {
      ...planFeatures,
      maxTasksPerSet: defaultMaxTasksPerSet,
      maxWordListWords: defaultMaxWordListWords,
      aiTaskSetsPerMonth: defaultAiTaskSetsPerMonth,
    };

    res.json({
      planName,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      // backwards compatible field name:
      aiGenerationsUsedThisPeriod: used,
      // new clearer fields:
      aiTaskSetsUsedThisPeriod: used,
      aiTaskSetsLimit: limit,
      aiTaskSetsRemaining: remaining,
      aiLimitTeaser,
      features,
    });
  } catch (err) {
    console.error("subscription /me error", err);
    res.status(500).json({ error: "Failed to load subscription info" });
  }
});

export default router;
