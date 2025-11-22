// backend/routes/subscriptionRoutes.js
import express from "express";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

const router = express.Router();

/**
 * Helper: find or create the single global subscription plan document.
 * For now, subscription is app-wide (not per-user).
 */
async function getOrCreatePlan() {
  let plan = await SubscriptionPlan.findOne();
  if (!plan) {
    plan = new SubscriptionPlan({
      tier: "FREE",
      aiTasksetsUsedThisMonth: 0,
    });
    await plan.save();
  }
  return plan;
}

/**
 * GET /api/subscription/plan
 * Returns the current global plan + usage.
 */
router.get("/plan", async (req, res) => {
  try {
    const plan = await getOrCreatePlan();
    res.json(plan);
  } catch (err) {
    console.error("GET /api/subscription/plan error:", err);
    res.status(500).json({ error: "Failed to load subscription plan" });
  }
});

/**
 * GET /api/subscription/me
 * Alias for now – same as /plan until we add per-user subscriptions.
 */
router.get("/me", async (req, res) => {
  try {
    const plan = await getOrCreatePlan();
    res.json(plan);
  } catch (err) {
    console.error("GET /api/subscription/me error:", err);
    res.status(500).json({ error: "Failed to load subscription info" });
  }
});

/**
 * POST /api/subscription/ai-usage
 * Called whenever an AI task set is successfully generated.
 * Increments aiTasksetsUsedThisMonth.
 */
router.post("/ai-usage", async (req, res) => {
  try {
    const plan = await getOrCreatePlan();
    plan.aiTasksetsUsedThisMonth = (plan.aiTasksetsUsedThisMonth || 0) + 1;
    await plan.save();

    res.json({
      ok: true,
      tier: plan.tier,
      aiTasksetsUsedThisMonth: plan.aiTasksetsUsedThisMonth,
    });
  } catch (err) {
    console.error("POST /api/subscription/ai-usage error:", err);
    res.status(500).json({ error: "Failed to update AI usage" });
  }
});

export default router;
