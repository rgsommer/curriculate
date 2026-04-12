import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
});

export async function POST(request: NextRequest) {
  try {
    const { userId, email } = await request.json();

    if (!userId || !email) {
      return NextResponse.json({ error: "Missing userId or email" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email,
      metadata: { user_id: userId },
      line_items: [
        {
          price: process.env.STRIPE_PREMIUM_PRICE_ID!, // Create this in Stripe Dashboard
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/campfirelive/settings?upgraded=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/campfirelive/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
