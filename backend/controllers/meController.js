// backend/controllers/meController.js
import User from "../models/User.js";
import TeacherProfile from "../models/TeacherProfile.js";
import { resolveAccessForUser } from "../billing/planResolver.js";

/**
 * GET /api/me
 * Stripe-first (practical): return authenticated user + teacher profile basics
 * plus a single "access" object resolved from billing (Stripe) + any overrides.
 *
 * NOTE:
 * - This controller intentionally relies on billing/planResolver.js (already in your repo)
 *   rather than introducing a second entitlement system.
 * - To keep backward compatibility, we also expose `plan` and `entitlements` as aliases of `access`.
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

    // Teacher profile is optional; keep this lightweight
    const teacherProfile =
      (await TeacherProfile.findOne({ userId: user._id }).lean()) ||
      (await TeacherProfile.findOne({ email: user.email }).lean());

    // Resolve effective access/plan from your existing billing logic (Stripe-first).
    // This should internally handle Stripe tier mapping + access-code/override logic if you implement it there.
    let access = null;
    try {
      access = await resolveAccessForUser(user);
    } catch (e) {
      console.error("resolveAccessForUser failed in /api/me:", e);
      access = null;
    }

    // Return a safe user payload (no secrets)
    const safeUser = {
      _id: user._id,
      email: user.email,
      name: user.name,

      // Admin flags (support both legacy patterns)
      isAdmin: !!user.isAdmin || !!teacherProfile?.isAdmin,
      role: user.role || (user.isAdmin ? "admin" : undefined),
      roles: Array.isArray(user.roles) ? user.roles : (user.isAdmin ? ["admin"] : []),

      // Billing identity/status (optional fields depending on your schema)
      subscriptionTier: user.subscriptionTier,
      subscriptionStatus: user.subscriptionStatus,
      stripeCustomerId: user.stripeCustomerId,
      currentPeriodEnd: user.currentPeriodEnd,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd,
    };

    return res.json({
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

      // Canonical resolved object
      access,

      // Friendly aliases (so frontend can transition without breaking)
      plan: access,
      entitlements: access,
    });
  } catch (err) {
    console.error("GET /api/me error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
