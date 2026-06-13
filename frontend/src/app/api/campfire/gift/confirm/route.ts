import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
  });
}
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Webhook fallback: when a contributor returns from Stripe checkout, verify the
// session directly and mark the contribution paid. So a chip-in confirms even if
// the Stripe webhook isn't configured. Idempotent and safe (we re-check Stripe).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session." }, { status: 400 });
    }
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.kind !== "gift_contribution") {
      return NextResponse.json({ ok: true, skipped: "not a gift" });
    }
    if (session.payment_status !== "paid") {
      return NextResponse.json({ ok: true, paid: false });
    }
    const contributionId = session.metadata?.contribution_id;
    if (!contributionId) {
      return NextResponse.json({ ok: true, skipped: "no contribution id" });
    }
    const admin = getAdmin();
    await admin
      .from("campfire_gift_contributions")
      .update({
        status: "paid",
        stripe_session_id: session.id,
        stripe_payment_intent: (session.payment_intent as string | null) ?? null,
      })
      .eq("id", contributionId)
      .neq("status", "refunded"); // never un-refund
    return NextResponse.json({ ok: true, paid: true });
  } catch (e) {
    console.error("Gift confirm error:", e);
    return NextResponse.json({ error: "Confirm failed." }, { status: 500 });
  }
}
