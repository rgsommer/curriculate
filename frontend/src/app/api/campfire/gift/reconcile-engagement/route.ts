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

// Host-facing "Refresh payments": reconcile this engagement's pending chip-ins
// against Stripe, using the caller's own login (no CRON_SECRET). Safe — it only
// confirms contributions Stripe reports as paid, scoped to this one engagement.
// Idempotent. A webhook fallback you can tap anytime something lands pending.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }

    const admin = getAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: eng } = await admin
      .from("engagements")
      .select("id, group_id, creator_id")
      .eq("id", engagementId)
      .single();
    if (!eng) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // Authorize: the engagement's creator or any member of its group.
    let allowed = uid === eng.creator_id;
    if (!allowed) {
      const { data: mem } = await admin
        .from("group_members")
        .select("user_id")
        .eq("group_id", eng.group_id)
        .eq("user_id", uid)
        .maybeSingle();
      allowed = !!mem;
    }
    if (!allowed) {
      return NextResponse.json({ error: "Not your group." }, { status: 403 });
    }

    const stripe = getStripe();
    // Look back ~45 days — long enough to cover any open chip-in window.
    const since = Math.floor((Date.now() - 45 * 24 * 60 * 60 * 1000) / 1000);

    let paidFixed = 0;
    let alreadyPaid = 0;
    let startingAfter: string | undefined;

    for (let page = 0; page < 50; page++) {
      const batch = await stripe.checkout.sessions.list({
        limit: 100,
        created: { gte: since },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const s of batch.data) {
        if (s.metadata?.kind !== "gift_contribution") continue;
        if (s.metadata?.engagement_id !== engagementId) continue;
        if (s.payment_status !== "paid") continue;
        const contributionId = s.metadata?.contribution_id;
        if (!contributionId) continue;

        const { data: row } = await admin
          .from("campfire_gift_contributions")
          .select("id, status")
          .eq("id", contributionId)
          .single();
        if (!row) continue;
        if (row.status === "paid") {
          alreadyPaid++;
          continue;
        }
        if (row.status === "refunded") continue;

        const { error: uErr } = await admin
          .from("campfire_gift_contributions")
          .update({
            status: "paid",
            stripe_session_id: s.id,
            stripe_payment_intent: (s.payment_intent as string | null) ?? null,
          })
          .eq("id", contributionId)
          .neq("status", "refunded");
        if (!uErr) paidFixed++;
      }
      if (!batch.has_more || batch.data.length === 0) break;
      startingAfter = batch.data[batch.data.length - 1]?.id;
    }

    return NextResponse.json({ ok: true, paidFixed, alreadyPaid });
  } catch (e) {
    console.error("Engagement reconcile error:", e);
    return NextResponse.json({ error: "Refresh failed." }, { status: 500 });
  }
}
