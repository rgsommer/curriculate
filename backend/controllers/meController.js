// backend/controllers/meController.js
import User from "../models/User.js";
import TeacherProfile from "../models/TeacherProfile.js";
import { getBaseTierFromUser, resolveEntitlements } from "../services/entitlementService.js";
import { resolvePlanForUser } from "../billing/planResolver.js";

/**
 * GET /api/me
 * Returns authenticated user + teacher profile basics + effective entitlements.
 * This becomes the single source of truth for the TeacherApp.
 */
export async function getMeController(req, res) {
  try {
    // authRequired should set something like req.user / req.userId
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId ||
      req.auth?.userId ||
      null;

    const email =
      req.user?.email ||
      req.auth?.email ||
      null;

    let user = null;

    if (userId) {
      user = await User.findById(userId).lean();
    } else if (email) {
      user = await User.findOne({ email: String(email).toLowerCase() }).lean();
    }

    if (!user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const teacherProfile =
      (await TeacherProfile.findOne({ userId: user._id }).lean()) ||
      (await TeacherProfile.findOne({ email: user.email }).lean());

    // Transitional: allow overrides to live on teacherProfile for now if you add them
    const overrides =
      teacherProfile?.entitlementOverrides ||
      teacherProfile?.entitlementsOverrides ||
      user?.entitlementOverrides ||
      [];

    const baseTier = getBaseTierFromUser(user, teacherProfile);
    const entitlements = resolveEntitlements({ baseTier, overrides });

    // Return a safe user payload
    const safeUser = {
      _id: user._id,
      email: user.email,
      name: user.name,
      isAdmin: !!user.isAdmin || !!teacherProfile?.isAdmin,
      role: user.role || (teacherProfile?.isAdmin ? "admin" : undefined),
      roles: Array.isArray(user.roles) ? user.roles : (user.isAdmin ? ["admin"] : []),

      subscriptionTier: user.subscriptionTier || baseTier,
      subscriptionStatus: user.subscriptionStatus, // if present in your schema
      stripeCustomerId: user.stripeCustomerId,     // if present
      currentPeriodEnd: user.currentPeriodEnd,     // if present
      cancelAtPeriodEnd: user.cancelAtPeriodEnd,   // if present
    };

    // Stripe-first: resolve effective plan + limits from billing system
    let plan = null;
    try {
    plan = await resolvePlanForUser({
        userId: user._id,
        email: user.email,
        subscriptionTier: user.subscriptionTier,
        stripeCustomerId: user.stripeCustomerId,
    });
    } catch (e) {
    console.error("planResolver failed in /api/me:", e);
    plan = null;
    }

    res.json({
      ok: true,
      user: safeUser,
      teacherProfile: teacherProfile
        ? {
            _id: teacherProfile._id,
            userId: teacherProfile.userId,
            isAdmin: !!teacherProfile.isAdmin,
            schoolName: teacherProfile.schoolName,
          }
        : null,
      plan,
      entitlements,
    });
  } catch (err) {
    console.error("GET /api/me error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
}
