import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

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
    const { priceId: rawPriceId, plan, email: rawEmail } = req.body || {};

    // Resolve priceId from either priceId or plan
    let priceId = rawPriceId;
    let effectivePlan = plan;

    // Trial plans: TEACHER_PRO_TRIAL -> TEACHER_PRO + trialPeriodDays
    const isTrial = typeof effectivePlan === "string" && effectivePlan.endsWith("_TRIAL");
    const trialDays = Number(process.env.TRIAL_DAYS || 30);

    if (!priceId) {
      if (typeof effectivePlan !== "string" || !effectivePlan) {
        return res.status(400).json({ error: "Missing priceId or plan" });
      }

      if (isTrial) effectivePlan = effectivePlan.replace(/_TRIAL$/, "");

      priceId = PRICE_BY_PLAN[effectivePlan];
      if (!priceId) {
        return res.status(400).json({ error: `Unknown plan: ${plan}` });
      }
    }

    const email = (rawEmail || "").trim().toLowerCase();

    // Resolve user:
    // - If some upstream middleware already set req.user, we’ll use it.
    // - Otherwise require email and find-or-create the user.
    let user = req.user;

    const db = await getMongo();
    const users = db.collection("users");

    if (!user) {
      if (!email) return res.status(401).json({ error: "Not authenticated" });

      const up = await users.findOneAndUpdate(
        { email },
        {
          $setOnInsert: {
            email,
            createdAt: new Date(),
            plan: "FREE",
            hasUsedTrial: false,
          },
          $set: { updatedAt: new Date() },
        },
        { upsert: true, returnDocument: "after" }
      );

      user = up.value;
      if (!user) return res.status(500).json({ error: "Unable to create user for checkout" });
    }

    // Ensure Stripe customer exists
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email || email || undefined,
        metadata: { userId: String(user._id || "") },
      });
      stripeCustomerId = customer.id;

      // Persist customer id (handle ObjectId vs string _id)
      const q = isHex24(String(user._id)) ? { _id: new ObjectId(String(user._id)) } : { _id: user._id };
      await users.updateOne(q, { $set: { stripeCustomerId, updatedAt: new Date() } });

      user.stripeCustomerId = stripeCustomerId;
    }

    // Build subscription_data with optional trial
    const subscription_data = {
      metadata: { plan: plan || effectivePlan, userId: String(user._id), userEmail: user.email || email || "" },
      ...(isTrial ? { trial_period_days: trialDays } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId || undefined,
      customer_email: stripeCustomerId ? undefined : (user.email || email || undefined),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl(),
      allow_promotion_codes: true,
      client_reference_id: String(user._id),
      subscription_data,
      payment_method_collection: "if_required",
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error("[stripe] create-checkout-session error:", e);
    res.status(500).json({ error: e?.message || "Failed to create checkout session" });
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
