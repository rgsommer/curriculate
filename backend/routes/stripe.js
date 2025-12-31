import express from "express";
import Stripe from "stripe";

import mongoose from "mongoose";
import User from "../models/User.js"; // ← adjust path if needed
import { authAny } from "../middleware/authAny.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
console.log("[stripeRoutes] PATCH LOADED 2025-12-30d");

function successUrl() {
  return process.env.STRIPE_CHECKOUT_SUCCESS_URL || "https://www.curriculate.net/billing/success";
}
function cancelUrl() {
  return process.env.STRIPE_CHECKOUT_CANCEL_URL || "https://www.curriculate.net/pricing";
}

const isHex24 = (s) => typeof s === "string" && /^[a-fA-F0-9]{24}$/.test(s);

router.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId, plan, email: rawEmail } = req.body || {};

    if (!priceId) return res.status(400).json({ error: "Missing priceId" });

    // Optional: trial support via plan token (e.g., "TEACHER_PRO_TRIAL")
    const isTrial = typeof plan === "string" && plan.endsWith("_TRIAL");
    const trialDays = Number(process.env.TRIAL_DAYS || 30);

    const email = (rawEmail || "").trim().toLowerCase();

    // 1) Resolve user (logged-in OR email fallback)
    let user = req.user || null;

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

      user = up.value || null;
    }

    if (!user) return res.status(401).json({ error: "Not authenticated" });

    // 2) Ensure Stripe customer exists
    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email || email || undefined,
        metadata: { userId: String(user._id || "") },
      });

      stripeCustomerId = customer.id;

      // Persist to DB (handle ObjectId vs string _id)
      const id = user._id;
      const q = isHex24(String(id)) ? { _id: new ObjectId(String(id)) } : { _id: id };

      await users.updateOne(q, { $set: { stripeCustomerId, updatedAt: new Date() } });

      // keep local copy consistent
      user.stripeCustomerId = stripeCustomerId;
    }

    // 3) Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId || undefined,
      customer_email: stripeCustomerId ? undefined : (user.email || email || undefined),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl(),
      allow_promotion_codes: true,
      client_reference_id: String(user._id),
      subscription_data: {
        metadata: {
          plan: plan || "",
          userId: String(user._id),
          userEmail: user.email || email || "",
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

router.use(authAny);

router.post("/create-portal-session", async (req, res) => {
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
