
import Stripe from "stripe";
import ProcessedStripeEvent from "../models/ProcessedStripeEvent.js";
import { handleStripeEvent } from "../billing/planResolver.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function stripeWebhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await ProcessedStripeEvent.create({
      eventId: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      processedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) return res.json({ ok: true, deduped: true });
    throw err;
  }

  await handleStripeEvent(event);
  res.json({ ok: true });
}
