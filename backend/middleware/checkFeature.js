// middleware/checkFeature.js
//const SubscriptionPlan = require('../models/SubscriptionPlan');
const UserSubscription = require('../models/UserSubscription');

async function ensureUserSubscription(userId) {
  let sub = await UserSubscription.findOne({ userId });

  if (!sub) {
    // Default: FREE plan, period = current month
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    sub = await UserSubscription.create({
      userId,
      planName: 'FREE',
      currentPeriodStart: start,
      currentPeriodEnd: end
    });
  }

  // Reset period if expired (simple version)
  const now = new Date();
  if (now > sub.currentPeriodEnd) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    sub.currentPeriodStart = start;
    sub.currentPeriodEnd = end;
    sub.aiGenerationsUsedThisPeriod = 0;
    await sub.save();
  }

  return sub;
}

function checkFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const userId = req.user._id;
      const sub = await ensureUserSubscription(userId);

      const plan = await SubscriptionPlan.findOne({ name: sub.planName });
      if (!plan) {
        return res.status(403).json({ error: 'Invalid subscription plan' });
      }

      const features = plan.features || {};

      // Special case: AI generator with quota
      if (featureKey === 'aiGenerateTaskset') {
        const max = features.maxAiGenerationsPerMonth;
        if (max != null && sub.aiGenerationsUsedThisPeriod >= max) {
          return res.status(403).json({
            error:
              'AI generation limit reached for this month. Upgrade your plan for more generations.'
          });
        }
        // Allowed; DO NOT increment here (do it after successful generation).
        return next();
      }

      if (!features[featureKey]) {
        return res.status(403).json({ error: 'This feature is not available on your plan.' });
      }

      // Attach plan/features to req for downstream
      req.subscriptionPlan = plan;
      req.subscription = sub;

      next();
    } catch (err) {
      console.error('checkFeature error', err);
      res.status(500).json({ error: 'Subscription check failed' });
    }
  };
}

module.exports = { checkFeature };
