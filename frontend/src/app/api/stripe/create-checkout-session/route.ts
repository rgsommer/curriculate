import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Map your plan names to Stripe Price IDs (set these env vars)
function priceIdForPlan(plan: string) {
  const p = (plan || "").toUpperCase();

  if (p === "TEACHER_PLUS") return process.env.STRIPE_PRICE_TEACHER_PLUS;
  if (p === "TEACHER_PRO") return process.env.STRIPE_PRICE_TEACHER_PRO;
  if (p === "SCHOOL_PLUS") return process.env.STRIPE_PRICE_SCHOOL_PLUS;
  if (p === "SCHOOL_PRO") return process.env.STRIPE_PRICE_SCHOOL_PRO;

  return undefined;
}

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    const body = await req.json().catch(() => ({}));

    const plan = typeof body.plan === "string" ? body.plan : "";
    const successUrl =
      typeof body.successUrl === "string"
        ? body.successUrl
        : `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"}/billing/success`;
    const cancelUrl =
      typeof body.cancelUrl === "string"
        ? body.cancelUrl
        : `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"}/pricing`;

    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: `Unknown plan "${plan}" or missing price env var.` },
        { status: 400 }
      );
    }

    // Optional: if you have user auth + customer id, pass it in the request body
    // so "Manage billing" can work. Safe to omit for now.
    const customerId =
      typeof body.customerId === "string" && body.customerId.startsWith("cus_")
        ? body.customerId
        : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      // This lets Stripe request/confirm email
      customer: customerId,
      customer_creation: customerId ? undefined : "always",

      // Helps with receipts & future portal sessions
      allow_promotion_codes: true,
      billing_address_collection: "auto",

      // You can turn this on later if you want tax handling
      // automatic_tax: { enabled: true },

      metadata: {
        plan,
        source: "pricing-page",
      },
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
