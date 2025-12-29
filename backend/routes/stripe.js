
import express from "express";
import Stripe from "stripe";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/create-checkout-session", requireAuth, async (req, res) => {
  try {
    const { priceId } = req.body;
    if (!priceId?.startsWith("price_")) {
      return res.status(400).json({ error: "Invalid priceId" });
    }

    const userId = String(req.user.id || req.user._id);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.STRIPE_CHECKOUT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL,
      client_reference_id: userId,
      metadata: { userId },
      customer_email: req.user.email,
      subscription_data: { metadata: { userId } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
