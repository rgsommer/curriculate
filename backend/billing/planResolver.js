import User from "../models/User.js";

/**
 * Curriculate Stripe → Plan resolver (Teacher + School tiers)
 *
 * Env vars (Render):
 * STRIPE_PRICE_TEACHER_PLUS_MONTHLY=price_...
 * STRIPE_PRICE_TEACHER_PRO_MONTHLY=price_...
 * STRIPE_PRICE_SCHOOL_PLUS_YEARLY=price_...
 * STRIPE_PRICE_SCHOOL_PRO_YEARLY=price_...
 * STRIPE_GRACE_DAYS=7   (optional)
 *
 * Downgrades: PERIOD END
 * - If Stripe sets cancel_at_period_end=true, we keep the plan active and set planWillDowngradeAt.
 * - When Stripe finally emits customer.subscription.deleted at period end, we downgrade to FREE.
 */

const PRICE_TO_TIER = {
  [process.env.STRIPE_PRICE_TEACHER_PLUS_MONTHLY]: "TEACHER_PLUS",
  [process.env.STRIPE_PRICE_TEACHER_PRO_MONTHLY]: "TEACHER_PRO",
  [process.env.STRIPE_PRICE_SCHOOL_PLUS_YEARLY]: "SCHOOL_PLUS",
  [process.env.STRIPE_PRICE_SCHOOL_PRO_YEARLY]: "SCHOOL_PRO",
};

// Limits/feature flags by tier (tailor freely; these are sane defaults)
export const PLAN = {
  FREE: {
    tier: "FREE",
    seats: 1,
    aiMonthly: 25,
    studentDetail: false,
    exportsPdf: false,
    prioritySupport: false,
    multiClass: false,
  },
  TEACHER_PLUS: {
    tier: "TEACHER_PLUS",
    seats: 3,
    aiMonthly: 250,
    studentDetail: true,
    exportsPdf: true,
    prioritySupport: false,
    multiClass: true,
  },
  TEACHER_PRO: {
    tier: "TEACHER_PRO",
    seats: 20,
    aiMonthly: 2000,
    studentDetail: true,
    exportsPdf: true,
    prioritySupport: true,
    multiClass: true,
  },
  SCHOOL_PLUS: {
    tier: "SCHOOL_PLUS",
    seats: 200, // “school” defaults; adjust to your model
    aiMonthly: 20000,
    studentDetail: true,
    exportsPdf: true,
    prioritySupport: true,
    multiClass: true,
  },
  SCHOOL_PRO: {
    tier: "SCHOOL_PRO",
    seats: 1000,
    aiMonthly: 100000,
    studentDetail: true,
    exportsPdf: true,
    prioritySupport: true,
    multiClass: true,
  },
};

const GRACE_DAYS = Number(process.env.STRIPE_GRACE_DAYS || 7);

function toDateFromUnixSeconds(sec) {
  if (!sec || typeof sec !== "number") return null;
  return new Date(sec * 1000);
}

function resolveTierFromPriceId(priceId) {
  const tier = PRICE_TO_TIER[priceId] || "FREE";
  return PLAN[tier] || PLAN.FREE;
}

export async function handleStripeEvent(event) {
  const obj = event.data?.object;

  switch (event.type) {
    // Link Stripe customer/subscription to your user early
    case "checkout.session.completed": {
      const userId = obj?.client_reference_id || obj?.metadata?.userId;
      if (!userId) return;

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            stripeCustomerId: obj.customer || null,
            stripeSubscriptionId: obj.subscription || null,
            lastBillingEventAt: new Date(),
          },
        }
      );
      return;
    }

    // Subscription lifecycle
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.resumed": {
      if (!obj) return;

      const item0 = obj.items?.data?.[0];
      const priceId = item0?.price?.id || null;
      const tier = resolveTierFromPriceId(priceId);

      const willDowngradeAt = obj.cancel_at_period_end
        ? toDateFromUnixSeconds(obj.current_period_end)
        : null;

      await User.updateOne(
        { $or: [{ stripeCustomerId: obj.customer }, { stripeSubscriptionId: obj.id }] },
        {
          $set: {
            // Tier + limits
            planTier: tier.tier,
            planPriceId: priceId,
            planSeats: tier.seats,
            planAiMonthly: tier.aiMonthly,
            planStudentDetail: tier.studentDetail,
            planExportsPdf: tier.exportsPdf,
            planPrioritySupport: tier.prioritySupport,
            planMultiClass: tier.multiClass,

            // Stripe
            stripeSubscriptionId: obj.id,
            stripeSubscriptionStatus: obj.status,
            planRenewsAt: toDateFromUnixSeconds(obj.current_period_end),
            planWillDowngradeAt: willDowngradeAt,

            // Paid again => clear past due
            billingPastDue: false,
            billingPastDueAt: null,
            billingGraceUntil: null,

            lastBillingEventAt: new Date(),
          },
        }
      );
      return;
    }

    // Subscription deleted (usually fired at period end if cancel_at_period_end was true)
    case "customer.subscription.deleted": {
      if (!obj) return;

      await User.updateOne(
        { $or: [{ stripeCustomerId: obj.customer }, { stripeSubscriptionId: obj.id }] },
        {
          $set: {
            planTier: "FREE",
            planPriceId: null,
            planSeats: PLAN.FREE.seats,
            planAiMonthly: PLAN.FREE.aiMonthly,
            planStudentDetail: PLAN.FREE.studentDetail,
            planExportsPdf: PLAN.FREE.exportsPdf,
            planPrioritySupport: PLAN.FREE.prioritySupport,
            planMultiClass: PLAN.FREE.multiClass,

            stripeSubscriptionStatus: obj.status,
            planRenewsAt: null,
            planWillDowngradeAt: null,

            billingPastDue: false,
            billingPastDueAt: null,
            billingGraceUntil: null,

            lastBillingEventAt: new Date(),
          },
        }
      );
      return;
    }

    // Invoice paid => good standing
    case "invoice.paid": {
      if (!obj) return;

      await User.updateOne(
        { stripeCustomerId: obj.customer },
        {
          $set: {
            billingPastDue: false,
            billingPastDueAt: null,
            billingGraceUntil: null,
            lastInvoicePaidAt: new Date(),
            lastBillingEventAt: new Date(),
          },
        }
      );
      return;
    }

    // Invoice failed => grace window
    case "invoice.payment_failed": {
      if (!obj) return;

      const now = new Date();
      const graceUntil = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

      await User.updateOne(
        { stripeCustomerId: obj.customer },
        {
          $set: {
            billingPastDue: true,
            billingPastDueAt: now,
            billingGraceUntil: graceUntil,
            lastBillingEventAt: now,
          },
        }
      );
      return;
    }

    default:
      return;
  }
}
