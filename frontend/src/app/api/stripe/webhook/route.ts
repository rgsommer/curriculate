import Stripe from "stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { MongoClient } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Mongo cached
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

async function getMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  const client = await global._mongoClientPromise;
  const dbName = process.env.MONGODB_DB || "curriculate";
  return client.db(dbName);
}

function planFromPriceId(priceId: string | undefined) {
  if (!priceId) return "FREE";
  if (priceId === process.env.STRIPE_PRICE_TEACHER_PLUS) return "TEACHER_PLUS";
  if (priceId === process.env.STRIPE_PRICE_TEACHER_PRO) return "TEACHER_PRO";
  if (priceId === process.env.STRIPE_PRICE_SCHOOL_PLUS) return "SCHOOL_PLUS";
  if (priceId === process.env.STRIPE_PRICE_SCHOOL_PRO) return "SCHOOL_PRO";
  return "PAID";
}

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    const db = await getMongo();

    const sig = headers().get("stripe-signature");
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !whsec) {
      return NextResponse.json({ ok: false, error: "Missing webhook signature/secret" }, { status: 400 });
    }

    const rawBody = await req.text();
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, whsec);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err?.message);
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const users = db.collection("users");

    // helper: update user from subscription
    async function applySubscription(sub: Stripe.Subscription) {
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const status = sub.status; // trialing, active, canceled, incomplete, ...
      const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

      const firstItem = sub.items.data?.[0];
      const priceId = firstItem?.price?.id;
      const mappedPlan = planFromPriceId(priceId);

      // Your rule:
      // - trialing/active => mappedPlan
      // - canceled/ended => FREE
      const currentPlan =
        status === "trialing" || status === "active" ? mappedPlan : "FREE";

      await users.updateOne(
        { stripeCustomerId: customerId },
        {
          $set: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            stripeStatus: status,
            plan: currentPlan,
            trialEndsAt: trialEnd,
            updatedAt: new Date(),
          },
        }
      );
    }

    if (event.type === "checkout.session.completed") {
      // optional: you can log this
    }

    if (event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await applySubscription(sub);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Stripe webhook error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}
