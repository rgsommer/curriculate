// backend/routes/subscriptionRoutes.js
import express from "express";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

const router = express.Router();

/**
 * Helper: find or create the single global subscription plan document.
 * The SubscriptionPlan schema REQUIRES a 'name' field.
 */
async function getOrCreatePlan() {
  // For now we treat the FREE plan as the "current" plan
  let plan = await SubscriptionPlan.findOne({ name: "FREE" });

  if (!plan) {
    plan = new SubscriptionPlan({
      name: "FREE",               // REQUIRED BY SCHEMA
      monthlyPriceCents: 0,
      features: {
        maxAiGenerationsPerMonth: 1,  // 1 AI task set / month for FREE
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: false,
        allowedCurriculumLenses: [],
        hasAnalyticsDashboard: false,
        canViewTasksetAnalytics: false,
        canEmailReports: false,
      },
      // Not in schema, but mongoose will still store it and we can read it:
      aiTasksetsUsedThisMonth: 0,
    });

    await plan.save();
  }

  return plan;
}

/**
 * GET /api/subscription/plan
 * Global plan definition + usage.
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
 * Alias for /plan for now.
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
 * Increments aiTasksetsUsedThisMonth (a loose field on this doc).
 */
router.post("/ai-usage", async (req, res) => {
  try {
    const plan = await getOrCreatePlan();

    // This field is not in the schema, but mongoose will still track it.
    plan.aiTasksetsUsedThisMonth = (plan.aiTasksetsUsedThisMonth || 0) + 1;
    await plan.save();

    res.json({
      ok: true,
      name: plan.name,
      aiTasksetsUsedThisMonth: plan.aiTasksetsUsedThisMonth,
    });
  } catch (err) {
    console.error("POST /api/subscription/ai-usage error:", err);
    res.status(500).json({ error: "Failed to update AI usage" });
  }
});

export default router;
