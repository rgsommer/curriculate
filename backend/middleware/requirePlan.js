// backend/middleware/requirePlan.js
const ORDER = ["FREE", "PLUS", "PRO"];

export function requirePlan(minTier) {
  const requiredIndex = ORDER.indexOf(minTier.toUpperCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const currentTier = (req.user.subscriptionTier || "FREE").toUpperCase();
    const currentIndex = ORDER.indexOf(currentTier);

    if (currentIndex < requiredIndex) {
      return res.status(403).json({
        error: `This feature requires ${minTier} or higher.`,
        currentTier,
        requiredTier: minTier.toUpperCase(),
      });
    }

    next();
  };
}
