// routes/subscriptionRoutes.js
const express = require('express');
const router = express.Router();
const SubscriptionPlan = require('../models/SubscriptionPlan');
const UserSubscription = require('../models/UserSubscription');
const { authRequired } = require('../middleware/authRequired');

router.get('/me', authRequired, async (req, res) => {
  try {
    const userId = req.user._id;
    let sub = await UserSubscription.findOne({ userId });

    if (!sub) {
      // Auto-create FREE if needed
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

    const plan = await SubscriptionPlan.findOne({ name: sub.planName });

    res.json({
      planName: sub.planName,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      aiGenerationsUsedThisPeriod: sub.aiGenerationsUsedThisPeriod,
      features: plan?.features || {}
    });
  } catch (err) {
    console.error('subscription /me error', err);
    res.status(500).json({ error: 'Failed to load subscription info' });
  }
});

module.exports = router;
