import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Lazily construct clients so a missing env var can't crash `next build`
// (module-scope construction runs during "collecting page data").
function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
  });
}

function getSupabaseAdmin() {
  // Server-side only, bypasses RLS
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const supabaseAdmin = getSupabaseAdmin();

  const body = await request.text();
  const sig = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Group-gift contribution → mark it paid (the reveal cron issues the card).
      if (session.metadata?.kind === "gift_contribution") {
        const contributionId = session.metadata?.contribution_id;
        if (contributionId) {
          await supabaseAdmin
            .from("campfire_gift_contributions")
            .update({
              status: "paid",
              stripe_session_id: session.id,
              stripe_payment_intent:
                (session.payment_intent as string | null) ?? null,
            })
            .eq("id", contributionId);
        }
        break;
      }

      // Otherwise it's a premium subscription checkout.
      const userId = session.metadata?.user_id;
      const customerId = session.customer as string;

      if (userId) {
        await supabaseAdmin
          .from("profiles")
          .update({
            is_premium: true,
            stripe_customer_id: customerId,
          })
          .eq("id", userId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Find user by stripe customer ID and downgrade
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();

      if (profile) {
        await supabaseAdmin
          .from("profiles")
          .update({ is_premium: false })
          .eq("id", profile.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      // Could send a notification to the user here
      console.log(`Payment failed for customer: ${customerId}`);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
