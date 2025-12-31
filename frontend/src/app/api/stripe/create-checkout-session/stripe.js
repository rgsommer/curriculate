import express from "express";
import Stripe from "stripe";
//import { ObjectId } from "mongodb";
import User from "../models/User.js"; // adjust if needed

// NOTE: Adjust this import if your mongo helper lives elsewhere.
// Common paths in your repo have been getMongo() used in other backend files.
import { getMongo } from "../db/mongo.js";

import { authAny } from "../middleware/authAny.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function successUrl() {
  return process.env.STRIPE_CHECKOUT_SUCCESS_URL || "https://www.curriculate.net/billing/success";
}
function cancelUrl() {
  return process.env.STRIPE_CHECKOUT_CANCEL_URL || "https://www.curriculate.net/pricing";
}

// Price map (fallback). Prefer env vars if you have them, but this matches your current pricing page.
const PRICE_BY_PLAN = {
  TEACHER_PLUS: process.env.STRIPE_PRICE_TEACHER_PLUS || "price_1SjgbNLduAaZuYj5Y8h138iq",
  TEACHER_PRO: process.env.STRIPE_PRICE_TEACHER_PRO || "price_1SjganLduAaZuYj5e0YozeDy",
  SCHOOL_PLUS: process.env.STRIPE_PRICE_SCHOOL_PLUS || "price_1SjgbuLduAaZuYj5qy8o6OSR",
  SCHOOL_PRO: process.env.STRIPE_PRICE_SCHOOL_PRO || "price_1SjgcTLduAaZuYj5LlaHf5M9",
};

function isHex24(s) {
  return typeof s === "string" && /^[a-fA-F0-9]{24}$/.test(s);
}

// Public-friendly checkout:
// - Logged-in users (cookies) will still work if you keep authAny elsewhere, but this endpoint no longer REQUIRES auth.
// - Anonymous marketing-site users can start checkout by providing an email.
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId, plan, email: rawEmail } = req.body || {};
    if (!priceId) return res.status(400).json({ error: "Missing priceId" });

    const email = (rawEmail || "").trim().toLowerCase();
    const isTrial = typeof plan === "string" && plan.endsWith("_TRIAL");
    const trialDays = Number(process.env.TRIAL_DAYS || 30);

    // 1) Resolve user (session OR email fallback)
    let user = req.user || null;

    if (!user) {
      if (!email) return res.status(401).json({ error: "Not authenticated" });

      user = await User.findOneAndUpdate(
        { email },
        {
          $setOnInsert: {
            email,
            subscriptionTier: "FREE",
            hasUsedTrial: false,
            // passwordHash left null intentionally
          },
          $set: { updatedAt: new Date() },
        },
        { upsert: true, new: true }
      );
    }

    if (!user) return res.status(401).json({ error: "Not authenticated" });

    // 2) Ensure Stripe customer
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(user._id) },
      });

      user.stripeCustomerId = customer.id;
      await user.save();
    }

    // 3) Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl(),
      allow_promotion_codes: true,
      client_reference_id: String(user._id),
      subscription_data: {
        metadata: {
          plan: plan || "",
          userId: String(user._id),
          userEmail: user.email,
        },
        ...(isTrial ? { trial_period_days: trialDays } : {}),
      },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error("[stripe] create-checkout-session error:", e);
    return res.status(500).json({ error: e?.message || "Failed to create checkout session" });
  }
});

// Portal should remain auth-only
router.post("/create-portal-session", authAny, async (req, res) => {
  try {
    const user = req.user;
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "No Stripe customer on file for this user" });
    }

    const returnUrl =
      (req.body && req.body.returnUrl) ||
      process.env.STRIPE_PORTAL_RETURN_URL ||
      "https://www.curriculate.net/my-plan";

    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: portal.url });
  } catch (e) {
    console.error("[stripe] create-portal-session error:", e);
    res.status(500).json({ error: e?.message || "Failed to create portal session" });
  }
});

export default router;
