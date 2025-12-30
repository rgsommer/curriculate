import Stripe from "stripe";
import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
}

// --- Mongo (cached) ---
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

/**
 * Plan tokens:
 * - TEACHER_PLUS
 * - TEACHER_PRO
 * - SCHOOL_PLUS
 * - SCHOOL_PRO
 * - TEACHER_PRO_TRIAL  <-- your $0 30-day trial for full Pro
 */
function priceIdForPlan(plan: string) {
  const p = (plan || "").toUpperCase();
  if (p === "TEACHER_PLUS") return process.env.STRIPE_PRICE_TEACHER_PLUS;
  if (p === "TEACHER_PRO") return process.env.STRIPE_PRICE_TEACHER_PRO;
  if (p === "SCHOOL_PLUS") return process.env.STRIPE_PRICE_SCHOOL_PLUS;
  if (p === "SCHOOL_PRO") return process.env.STRIPE_PRICE_SCHOOL_PRO;

  // Trial uses Pro price
  if (p === "TEACHER_PRO_TRIAL") return process.env.STRIPE_PRICE_TEACHER_PRO;

  return undefined;
}

function isTrialPlan(plan: string) {
  return (plan || "").toUpperCase() === "TEACHER_PRO_TRIAL";
}

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    const db = await getMongo();

    const body = await req.json().catch(() => ({}));
    const plan = typeof body.plan === "string" ? body.plan : "";
    const userId = typeof body.userId === "string" ? body.userId : ""; // from your auth/session
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!plan) {
      return NextResponse.json({ ok: false, error: "Missing plan" }, { status: 400 });
    }

    // You said A is true: users exist. We’ll require userId so trial attaches to the user.
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Missing userId (not logged in)." },
        { status: 401 }
      );
    }

    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: `Unknown plan "${plan}" or missing STRIPE_PRICE env var.` },
        { status: 400 }
      );
    }

    const successUrl =
      typeof body.successUrl === "string"
        ? body.successUrl
        : `${siteUrl()}/billing/success`;
    const cancelUrl =
      typeof body.cancelUrl === "string"
        ? body.cancelUrl
        : `${siteUrl()}/pricing`;

    // Look up user record
    const users = db.collection("users");
    const user = await users.findOne({ _id: userId as any });

    // Create or reuse Stripe customer
    let customerId: string | undefined = user?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || user?.email,
        metadata: { userId },
      });
      customerId = customer.id;

      await users.updateOne(
        { _id: userId as any },
        { $set: { stripeCustomerId: customerId, updatedAt: new Date() } }
      );
    }

    const trialDays = Number(process.env.TRIAL_DAYS || 30);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      // Key bit:
      subscription_data: isTrialPlan(plan)
        ? {
            trial_period_days: trialDays,
            cancel_at_period_end: true, // ensures it ends after trial → user becomes Free
            metadata: { plan, userId, trial: "true" },
          }
        : {
            metadata: { plan, userId },
          },

      // Reduce friction for a true $0 trial:
      payment_method_collection: isTrialPlan(plan) ? "if_required" : "always",

      allow_promotion_codes: true,
      billing_address_collection: "auto",
      metadata: { plan, userId },
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err: any) {
    console.error("create-checkout-session error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
