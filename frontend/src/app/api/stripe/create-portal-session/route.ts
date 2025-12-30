import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    const body = await req.json().catch(() => ({}));

    const customerId =
      typeof body.customerId === "string" && body.customerId.startsWith("cus_")
        ? body.customerId
        : null;

    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "Missing customerId (cus_...). Hook this to your logged-in user." },
        { status: 401 }
      );
    }

    const returnUrl =
      typeof body.returnUrl === "string"
        ? body.returnUrl
        : `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"}/pricing`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ ok: true, url: portal.url });
  } catch (err: any) {
    console.error("create-portal-session error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
