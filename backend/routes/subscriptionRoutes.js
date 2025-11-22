// backend/routes/subscriptionRoutes.js
import express from "express";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

const router = express.Router();

/**
 * Seed the 3-tier subscription structure:
 *
 *  FREE
 *  PLUS
 *  PRO
 *
 *  This will only create missing tiers.
 */
async function seedPlans() {
  const defaults = [
    {
      name: "FREE",
      monthlyPriceCents: 0,
      features: {
        maxAiGenerationsPerMonth: 1,
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: false,
        allowedCurriculumLenses: [],
        hasAnalyticsDashboard: false,
        canViewTasksetAnalytics: false,
        canEmailReports: false,
      },
    },
    {
      name: "TEACHER_PLUS",
      monthlyPriceCents: 999, // $9.99/mo
      features: {
        maxAiGenerationsPerMonth: 20,
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: true,
        allowedCurriculumLenses: ["Academic", "Biblical", "Creative"],
        hasAnalyticsDashboard: true,
        canViewTasksetAnalytics: true,
        canEmailReports: true,
      },
    },
    {
      name: "SCHOOL",
      monthlyPriceCents: 4999, // $49.99/mo
      features: {
        maxAiGenerationsPerMonth: 999,
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: true,
        allowedCurriculumLenses: ["Academic", "Biblical", "Creative"],
        hasAnalyticsDashboard: true,
        canViewTasksetAnalytics: true,
        canEmailReports: true,
      },
    },
  ];

  for (const plan of defaults) {
    const exists = await SubscriptionPlan.findOne({ name: plan.name });
    if (!exists) {
      await SubscriptionPlan.create(plan);
      console.log(`Seeded plan: ${plan.name}`);
    }
  }
}

seedPlans();

/**
 * Instead of "current teacher", we return the GLOBAL plan.
 * Default is FREE.
 */
async function getCurrentPlan() {
  let plan = await SubscriptionPlan.findOne({ name: "FREE" }).lean();

  if (!plan) {
    plan = await SubscriptionPlan.create({
      name: "FREE",
      monthlyPriceCents: 0,
      features: {
        maxAiGenerationsPerMonth: 1,
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: false,
        allowedCurriculumLenses: [],
        hasAnalyticsDashboard: false,
        canViewTasksetAnalytics: false,
        canEmailReports: false,
      },
    });
  }

  return plan;
}

/**
 * GET /api/subscription/plan
 */
router.get("/plan", async (req, res) => {
  try {
    const plan = await getCurrentPlan();
    res.json(plan);
  } catch (err) {
    console.error("GET /api/subscription/plan:", err);
    res.status(500).json({ error: "Failed to load subscription plan" });
  }
});

/**
 * GET /api/subscription/me
 * Alias for now
 */
router.get("/me", async (req, res) => {
  try {
    const plan = await getCurrentPlan();
    res.json(plan);
  } catch (err) {
    console.error("GET /api/subscription/me:", err);
    res.status(500).json({ error: "Failed to load subscription info" });
  }
});

/**
 * POST /api/subscription/ai-usage
 */
router.post("/ai-usage", async (req, res) => {
  try {
    const plan = await getCurrentPlan();

    // Soft field — not part of schema, but mongoose allows it
    plan.aiTasksetsUsedThisMonth =
      (plan.aiTasksetsUsedThisMonth ?? 0) + 1;

    const updated = await SubscriptionPlan.findOneAndUpdate(
      { name: plan.name },
      plan,
      { new: true }
    );

    res.json({
      ok: true,
      aiTasksetsUsedThisMonth: updated.aiTasksetsUsedThisMonth,
    });
  } catch (err) {
    console.error("POST /api/subscription/ai-usage:", err);
    res.status(500).json({ error: "Failed to increment AI usage" });
  }
});

export default router;
