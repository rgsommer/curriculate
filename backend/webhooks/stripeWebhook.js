
import Stripe from "stripe";
import ProcessedStripeEvent from "../models/ProcessedStripeEvent.js";
import { handleStripeEvent } from "../billing/planResolver.js";

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("[stripeWebhook] STRIPE_SECRET_KEY is not set");
  return (_stripe = new Stripe(key));
}
const stripe = new Proxy({}, { get: (_, prop) => getStripe()[prop] });

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
