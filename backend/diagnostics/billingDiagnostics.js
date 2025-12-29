
import express from "express";
import Stripe from "stripe";
import User from "../models/User.js";
import ProcessedStripeEvent from "../models/ProcessedStripeEvent.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.get("/billing/diagnostics", async (req, res) => {
  const { userId } = req.query;
  const user = await User.findById(userId).lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  let customer = null;
  let subscription = null;

  if (user.stripeCustomerId) {
    customer = await stripe.customers.retrieve(user.stripeCustomerId);
  }
  if (user.stripeSubscriptionId) {
    subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  }

  const lastEvent = await ProcessedStripeEvent.findOne().sort({ processedAt: -1 });

  res.json({
    env: process.env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test",
    user,
    stripe: { customer, subscription },
    lastEvent,
  });
});

export default router;
