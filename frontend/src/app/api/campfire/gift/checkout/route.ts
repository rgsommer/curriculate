import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Lazy clients so a missing env var can't crash `next build`.
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

// Start a contribution: record it (pending) and open a Stripe Checkout for the amount.
// The webhook flips it to "paid" once Stripe confirms.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    const amountCents = Number(body?.amountCents);
    const contributorName =
      typeof body?.contributorName === "string"
        ? body.contributorName.slice(0, 80)
        : null;
    const userId = typeof body?.userId === "string" ? body.userId : null;
    const email = typeof body?.email === "string" ? body.email : undefined;

    if (!engagementId || !Number.isFinite(amountCents) || amountCents < 100) {
      return NextResponse.json(
        { error: "A valid engagement and amount (min $1) are required." },
        { status: 400 }
      );
    }
    if (amountCents > 50000) {
      return NextResponse.json({ error: "That's a bit much — max $500." }, { status: 400 });
    }

    const admin = getAdmin();
    const { data: eng } = await admin
      .from("engagements")
      .select("id, group_id, gift_enabled, title")
      .eq("id", engagementId)
      .single();
    if (!eng || !eng.gift_enabled) {
      return NextResponse.json(
        { error: "This activity isn't collecting a gift." },
        { status: 400 }
      );
    }

    // Record the pending contribution first so the webhook has a row to confirm.
    const { data: contribution, error: cErr } = await admin
      .from("campfire_gift_contributions")
      .insert({
        engagement_id: engagementId,
        user_id: userId,
        contributor_name: contributorName,
        amount_cents: Math.round(amountCents),
        status: "pending",
      })
      .select("id")
      .single();
    if (cErr || !contribution) {
      return NextResponse.json({ error: "Couldn't start the contribution." }, { status: 500 });
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
    const back = `${site}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountCents),
            product_data: {
              name: `Group gift — "${eng.title}"`,
              description: "Your chip-in toward the group gift card.",
            },
          },
        },
      ],
      metadata: {
        kind: "gift_contribution",
        contribution_id: contribution.id as string,
        engagement_id: engagementId,
      },
      success_url: `${back}?gift=thanks`,
      cancel_url: `${back}?gift=cancel`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("Gift checkout error:", e);
    return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
  }
}
