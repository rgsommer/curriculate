
import User from "../models/User.js";

const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_PLUS_MONTHLY]: "PLUS",
  [process.env.STRIPE_PRICE_PRO_MONTHLY]: "PRO",
};

export async function handleStripeEvent(event) {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const userId = obj.client_reference_id || obj.metadata?.userId;
      if (!userId) return;
      await User.updateOne(
        { _id: userId },
        {
          stripeCustomerId: obj.customer,
          stripeSubscriptionId: obj.subscription,
        }
      );
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.resumed": {
      const priceId = obj.items.data[0].price.id;
      const plan = PRICE_TO_PLAN[priceId] || "FREE";
      await User.updateOne(
        { stripeCustomerId: obj.customer },
        {
          plan,
          planPriceId: priceId,
          stripeSubscriptionStatus: obj.status,
          planRenewsAt: new Date(obj.current_period_end * 1000),
        }
      );
      break;
    }

    case "customer.subscription.deleted": {
      await User.updateOne(
        { stripeCustomerId: obj.customer },
        {
          plan: "FREE",
          planPriceId: null,
          stripeSubscriptionStatus: obj.status,
        }
      );
      break;
    }

    case "invoice.payment_failed": {
      await User.updateOne(
        { stripeCustomerId: obj.customer },
        { billingPastDue: true }
      );
      break;
    }

    case "invoice.paid": {
      await User.updateOne(
        { stripeCustomerId: obj.customer },
        { billingPastDue: false, lastInvoicePaidAt: new Date() }
      );
      break;
    }
  }
}
