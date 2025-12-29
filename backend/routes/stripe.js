import express from "express";
import Stripe from "stripe";
import { authAny } from "../middleware/authAny.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function successUrl() {
  return process.env.STRIPE_CHECKOUT_SUCCESS_URL || "https://www.curriculate.net/billing/success";
}
function cancelUrl() {
  return process.env.STRIPE_CHECKOUT_CANCEL_URL || "https://www.curriculate.net/pricing";
}

router.post("/create-checkout-session", authAny, async (req, res) => {
  try {
    const { priceId } = req.body || {};
    if (!priceId) return res.status(400).json({ error: "Missing priceId" });

    const user = req.user;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl(),
      allow_promotion_codes: true,
      client_reference_id: String(user._id),
      metadata: { userId: String(user._id), userEmail: user.email || "" },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error("[stripe] create-checkout-session error:", e);
    res.status(500).json({ error: e?.message || "Failed to create checkout session" });
  }
});

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
