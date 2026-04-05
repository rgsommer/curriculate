/**
 * Tier-based plan gate middleware.
 *
 * Usage:
 *   router.get("/analytics", authRequired, requirePlan("PLUS"), handler)
 *
 * Tier order (ascending): FREE < PLUS < PRO
 * A user on PRO passes a PLUS gate.
 */

const TIER_RANK = { FREE: 0, PLUS: 1, PRO: 2 };

function isInGrace(user) {
  if (!user?.billingPastDue) return false;
  if (!user?.billingGraceUntil) return false;
  return Date.now() < new Date(user.billingGraceUntil).getTime();
}

export function requirePlan(minimumTier) {
  const minRank = TIER_RANK[minimumTier] ?? 1;

  return (req, res, next) => {
    const user = req.user;

    // Grace-period bypass — billing lapsed but still within grace window
    if (isInGrace(user)) return next();

    const tier = user?.planTier || "FREE";
    const rank = TIER_RANK[tier] ?? 0;

    if (rank >= minRank) return next();

    return res.status(403).json({
      ok: false,
      error: "Plan upgrade required",
      requiredPlan: minimumTier,
      currentPlan: tier,
    });
  };
}

export default requirePlan;
