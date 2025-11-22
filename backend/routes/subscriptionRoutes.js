// backend/routes/subscriptionRoutes.js
import express from "express";
import SubscriptionPlan from "../models/SubscriptionPlan.js";
import UserSubscription from "../models/UserSubscription.js";
import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();

/**
 * Utility: Ensure a user has a subscription document.
 * Auto-provisions FREE with monthly reset window.
 */
async function getOrCreateUserSub(userId) {
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

  return sub;
}

/**
 * Utility: Compute the resolved subscription limits & teaser message.
 */
async function buildSubscriptionResponse(sub) {
  const planName = sub.planName || "FREE";

  const plan = await SubscriptionPlan.findOne({ name: planName });
  const featureOverrides = plan?.features || {};

  // Defaults if NONE in database:
  const maxTasksPerSet =
    featureOverrides.maxTasksPerSet ??
    (planName === "FREE" ? 5 : planName === "PLUS" ? 20 : 50);

  const maxWordListWords =
    featureOverrides.maxWordListWords ??
    (planName === "FREE" ? 10 : planName === "PLUS" ? 100 : 9999);

  const aiTaskSetsPerMonth =
    featureOverrides.aiTaskSetsPerMonth ??
    (planName === "FREE" ? 1 : planName === "PLUS" ? 50 : 9999);

  const used = sub.aiGenerationsUsedThisPeriod || 0;
  const limit = aiTaskSetsPerMonth;
  const remaining = Math.max(0, limit - used);

  let aiLimitTeaser = "";
  if (remaining <= 0) {
    if (planName === "FREE") {
      aiLimitTeaser =
        "You’ve used your 1 AI task set for this month on the Free plan. Upgrade to PLUS or PRO for more AI-generated task sets and richer reporting.";
    } else if (planName === "PLUS") {
      aiLimitTeaser =
        "You’ve used all your AI task sets for this billing period. PRO increases monthly limits and unlocks deeper analytics.";
    }
  }

  return {
    planName,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,

    // Backwards compatibility
    aiGenerationsUsedThisPeriod: used,

    // Newer clearer names
    aiTaskSetsUsedThisPeriod: used,
    aiTaskSetsLimit: limit,
    aiTaskSetsRemaining: remaining,
    aiLimitTeaser,

    features: {
      maxTasksPerSet,
      maxWordListWords,
      aiTaskSetsPerMonth,
      ...featureOverrides,
    },
  };
}

/**
 * GET /api/subscription/me
 * Auth required — tied to the logged-in teacher.
 */
router.get("/me", authRequired, async (req, res) => {
  try {
    const userId = req.user._id;
    const sub = await getOrCreateUserSub(userId);

    const result = await buildSubscriptionResponse(sub);
    return res.json(result);
  } catch (err) {
    console.error("subscription /me error:", err);
    return res.status(500).json({ error: "Failed to load subscription info" });
  }
});

/**
 * GET /api/subscription/plan
 * Same response as /me — but **without requiring login**.
 * Useful for:
 *   - Task Generator UI
 *   - MyPlan page for non-auth scenarios
 *   - Older versions of teacher app
 */
router.get("/plan", async (req, res) => {
  try {
    let sub;

    // If authenticated, use the user’s subscription:
    if (req.user && req.user._id) {
      sub = await getOrCreateUserSub(req.user._id);
    } else {
      // Otherwise return a generic FREE profile
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      sub = {
        planName: "FREE",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        aiGenerationsUsedThisPeriod: 0,
      };
    }

    const result = await buildSubscriptionResponse(sub);
    return res.json(result);
  } catch (err) {
    console.error("subscription /plan error:", err);
    return res.status(500).json({ error: "Failed to load subscription plan" });
  }
});

export default router;
