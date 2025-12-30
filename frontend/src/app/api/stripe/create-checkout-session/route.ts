import Stripe from "stripe";
import { NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
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

    // Auth / identity:
    // - If userId is provided (logged-in flow), we attach checkout to that user.
    // - If userId is missing but email is provided (marketing-site flow), we find-or-create a user by email.
    // This keeps portal access auth-only while allowing public pricing/trial checkout to function.

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
    // Resolve user record
    let resolvedUserId: string | undefined = userId;

    // If no userId, allow email-based identity for public checkout
    if (!resolvedUserId) {
      if (!email) {
        return NextResponse.json(
          { ok: false, error: "Not authenticated (missing userId and email)." },
          { status: 401 }
        );
      }

      const emailLower = email.toLowerCase();

      // Find-or-create user by email
      const upsertRes = await users.findOneAndUpdate(
        { email: emailLower },
        {
          $setOnInsert: {
            email: emailLower,
            createdAt: new Date(),
            plan: "FREE",
            hasUsedTrial: false,  # placeholder to be fixed
          },
          $set: {
            updatedAt: new Date(),
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      const upsertedUser = upsertRes.value;
      if (!upsertedUser) {
        return NextResponse.json(
          { ok: false, error: "Unable to create user for checkout." },
          { status: 500 }
        );
      }

      // Use the created/found user's id
      resolvedUserId =
        typeof upsertedUser._id === "string" ? upsertedUser._id : String(upsertedUser._id);
    }

    // Convert string to ObjectId when possible
    const userQuery =
      /^[a-fA-F0-9]{24}$/.test(resolvedUserId!)
        ? { _id: new ObjectId(resolvedUserId!) }
        : { _id: resolvedUserId };

    const user = await users.findOne(userQuery);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "User not found (invalid userId for this environment)." },
        { status: 401 }
      );
    }

    // ---- One-trial-per-user protection ----
    const planUpper = plan.toUpperCase();
    const isTrial = planUpper === "TEACHER_PRO_TRIAL";

    if (isTrial && (user as any)?.hasUsedTrial) {
      return NextResponse.json(
        { ok: false, error: "Trial already used for this account." },
        { status: 409 }
      );
    }

    // Create or reuse Stripe customer
    let customerId: string | undefined = (user as any)?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || (user as any)?.email,
        metadata: { userId: String((user as any)?._id ?? userId) },
      });

      customerId = customer.id;

      await users.updateOne(
        userQuery,
        { $set: { stripeCustomerId: customerId, updatedAt: new Date() } }
      );
    }

    const trialDays = Number(process.env.TRIAL_DAYS || 30);
    
    // Build subscription_data without TS union headaches
    const subscription_data: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: { plan, userId: resolvedUserId },
    };

    if (isTrial) {
      subscription_data.trial_period_days = trialDays;
      subscription_data.metadata = { plan, userId, trial: "true" };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      subscription_data,

      payment_method_collection: isTrial ? "if_required" : "always",
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      metadata: { plan, userId: resolvedUserId },
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
