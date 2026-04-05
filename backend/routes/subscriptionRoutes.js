import express from "express";
import SubscriptionPlan from "../models/SubscriptionPlan.js";
import User from "../models/User.js";
import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();

/**
 * Seed the 3-tier subscription structure:
 *
 *  FREE
 *  TEACHER_PLUS
 *  SCHOOL
 *
 * Only creates missing tiers; existing docs are left alone.
 */
async function seedPlans() {
  const defaults = [
    {
      name: "FREE",
      monthlyPriceCents: 0,
      features: {
        maxAiGenerationsPerMonth: 1, // 1 AI task set / month
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
      monthlyPriceCents: 4999, // $49.99/mo – whatever you like
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
      console.log(`Seeded subscription plan: ${plan.name}`);
    }
  }
}

// Fire and forget seed on startup
seedPlans().catch((err) => {
  console.error("Failed seeding subscription plans:", err);
});

/**
 * Helper: for now we just pick the FREE plan as the "current" one.
 * Later this can depend on the logged-in presenter.
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

// GET /api/subscription/plan
router.get("/plan", async (req, res) => {
  try {
    const plan = await getCurrentPlan();
    res.json(plan);
  } catch (err) {
    console.error("GET /api/subscription/plan error:", err);
    res.status(500).json({ error: "Failed to load subscription plan" });
  }
});

// GET /api/subscription/me (alias)
// Bug 3: Return actual user subscription instead of hardcoded FREE
router.get("/me", authRequired, async (req, res) => {
  try {
    // Get userId from JWT auth (req.user should be populated by auth middleware)
    const userId = req.user?._id || req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Look up user's actual subscription status
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return actual subscription data from user document
    const subscriptionData = {
      userId: String(user._id),
      planTier: user.subscriptionTier || user.planTier || "FREE",
      stripeCustomerId: user.stripeCustomerId || null,
      stripeSubscriptionId: user.stripeSubscriptionId || null,
      subscriptionStatus: user.subscriptionStatus || user.stripeSubscriptionStatus || null,

      // Plan features/limits
      seats: user.planSeats || 1,
      aiMonthly: user.planAiMonthly || 0,
      studentDetail: !!user.planStudentDetail,
      exportsPdf: !!user.planExportsPdf,
      prioritySupport: !!user.planPrioritySupport,
      multiClass: !!user.planMultiClass,

      // Renewal/downgrade info
      planRenewsAt: user.planRenewsAt || null,
      planWillDowngradeAt: user.planWillDowngradeAt || null,
      cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,

      // Billing status
      billingPastDue: !!user.billingPastDue,
      billingPastDueAt: user.billingPastDueAt || null,
      billingGraceUntil: user.billingGraceUntil || null,
    };

    res.json(subscriptionData);
  } catch (err) {
    console.error("GET /api/subscription/me error:", err);
    res.status(500).json({ error: "Failed to load subscription info" });
  }
});

// POST /api/subscription/ai-usage
router.post("/ai-usage", async (req, res) => {
  try {
    const plan = await getCurrentPlan();
    const used = (plan.aiTasksetsUsedThisMonth ?? 0) + 1;

    await SubscriptionPlan.updateOne(
      { name: plan.name },
      { $set: { aiTasksetsUsedThisMonth: used } },
      { upsert: true }
    );

    res.json({
      ok: true,
      aiTasksetsUsedThisMonth: used,
    });
  } catch (err) {
    console.error("POST /api/subscription/ai-usage error:", err);
    res.status(500).json({ error: "Failed to update AI usage" });
  }
});

export default router;
