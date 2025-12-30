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

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    const db = await getMongo();

    const body = await req.json().catch(() => ({}));
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Missing userId" }, { status: 401 });
    }

    const user = await db.collection("users").findOne({ _id: userId as any });
    const customerId = user?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "No Stripe customer on file for this user." },
        { status: 400 }
      );
    }

    const returnUrl =
      typeof body.returnUrl === "string" ? body.returnUrl : `${siteUrl()}/pricing`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ ok: true, url: portal.url });
  } catch (err: any) {
    console.error("create-portal-session error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}
