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

// Refund every paid contribution for an engagement (called when the host cancels a
// gift card before it's issued). Only the engagement's creator may trigger it.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }
    const admin = getAdmin();

    // Auth: the caller must be this engagement's creator.
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: eng } = await admin
      .from("engagements")
      .select("creator_id, gift_issued_at")
      .eq("id", engagementId)
      .single();
    if (!eng) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (eng.creator_id !== uid) {
      return NextResponse.json({ error: "Only the host can refund." }, { status: 403 });
    }
    if (eng.gift_issued_at) {
      // Already sent to the recipient — can't claw it back here.
      return NextResponse.json({ ok: true, refunded: 0, alreadyIssued: true });
    }

    const { data: contribs } = await admin
      .from("campfire_gift_contributions")
      .select("id, stripe_payment_intent")
      .eq("engagement_id", engagementId)
      .eq("status", "paid");

    const stripe = getStripe();
    let refunded = 0;
    for (const c of contribs ?? []) {
      const pi = c.stripe_payment_intent as string | null;
      if (!pi) continue;
      try {
        await stripe.refunds.create({ payment_intent: pi });
        await admin
          .from("campfire_gift_contributions")
          .update({ status: "refunded" })
          .eq("id", c.id);
        refunded++;
      } catch (e) {
        console.error(`Refund failed for contribution ${c.id}:`, e);
      }
    }
    return NextResponse.json({ ok: true, refunded });
  } catch (e) {
    console.error("Gift refund error:", e);
    return NextResponse.json({ error: "Refund failed." }, { status: 500 });
  }
}
