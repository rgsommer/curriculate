/**
 * Feature gate middleware for Curriculate plans.
 *
 * Expects req.user to be populated (your existing auth middleware).
 * This middleware checks user.planTier and related plan flags stored on the user document.
 *
 * Usage examples:
 *   router.get("/reports/student/:id", requireAuth, requirePlanFeature("studentDetail"), handler)
 *   router.post("/reports/pdf", requireAuth, requirePlanFeature("exportsPdf"), handler)
 *
 * Behavior during billing grace period:
 * - If billingPastDue is true but now < billingGraceUntil => ALLOW (you asked for grace period)
 * - If grace expired => block gated features (still allow basic access).
 */

function nowMs() {
  return Date.now();
}

function isInGrace(user) {
  if (!user) return false;
  if (!user.billingPastDue) return false;
  if (!user.billingGraceUntil) return false;
  const graceUntil = new Date(user.billingGraceUntil).getTime();
  return nowMs() < graceUntil;
}

export function requirePlanFeature(featureKey) {
  return (req, res, next) => {
    const user = req.user;

    // If you haven't migrated old users yet, treat missing planTier as FREE.
    const tier = user?.planTier || "FREE";

    // Allow during grace window even if past due
    if (isInGrace(user)) return next();

    // feature flags stored on user for speed + simplicity
    const flagMap = {
      studentDetail: !!user?.planStudentDetail,
      exportsPdf: !!user?.planExportsPdf,
      prioritySupport: !!user?.planPrioritySupport,
      multiClass: !!user?.planMultiClass,
    };

    // seats + quotas are numeric limits (use helpers instead of this middleware)
    if (featureKey === "seats" || featureKey === "aiMonthly") {
      return res.status(400).json({ error: "Use requireSeats / requireAiQuota for numeric limits" });
    }

    const allowed = flagMap[featureKey];

    if (allowed) return next();

    return res.status(403).json({
      error: "Plan upgrade required",
      feature: featureKey,
      planTier: tier,
    });
  };
}

/**
 * Numeric gates
 */
export function requireSeats(minSeats) {
  return (req, res, next) => {
    const user = req.user;
    if (isInGrace(user)) return next();

    const seats = Number(user?.planSeats || 1);
    if (seats >= minSeats) return next();

    return res.status(403).json({ error: "Insufficient seats for this action", required: minSeats, seats });
  };
}

export function requireAiQuota(minMonthly) {
  return async (req, res, next) => {
    const user = req.user;
    if (isInGrace(user)) return next();

    // planAiMonthly is set by Stripe webhooks. Fall back to the plan-table
    // default so accounts created before billing was wired up still work.
    let q = Number(user?.planAiMonthly ?? -1);
    if (q < 0) {
      // Field not set → look up from plan table
      try {
        const { resolveAccessForUser } = await import("../billing/planResolver.js");
        const access = await resolveAccessForUser(user);
        q = Number(access?.aiMonthly || 0);
      } catch {
        q = 25; // safe fallback: FREE tier default
      }
    }

    if (q >= minMonthly) return next();

    return res.status(403).json({ error: "Insufficient AI quota for this action", required: minMonthly, aiMonthly: q });
  };
}
