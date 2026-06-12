import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { issueGiftCard } from "@/lib/campfire/gifts";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Manually send the pooled gift now (for engagements that don't auto-reveal, like a
// Sign-up). The host OR whoever started the chip-in may trigger it. Idempotent.
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

    const { data: e } = await admin
      .from("engagements")
      .select(
        "id, title, creator_id, gift_initiated_by, gift_enabled, gift_issued_at, gift_recipient_email, gift_recipient_name, gift_currency"
      )
      .eq("id", engagementId)
      .single();
    if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (uid !== e.creator_id && uid !== e.gift_initiated_by) {
      return NextResponse.json(
        { error: "Only the host or whoever started the chip-in can send it." },
        { status: 403 }
      );
    }
    if (!e.gift_enabled || !e.gift_recipient_email) {
      return NextResponse.json({ error: "No gift to send." }, { status: 400 });
    }
    if (e.gift_issued_at) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    const { data: contribs } = await admin
      .from("campfire_gift_contributions")
      .select("amount_cents")
      .eq("engagement_id", engagementId)
      .eq("status", "paid");
    const totalCents = (contribs ?? []).reduce(
      (a, c) => a + (c.amount_cents as number),
      0
    );
    if (totalCents <= 0) {
      return NextResponse.json({ error: "No contributions yet." }, { status: 400 });
    }

    const result = await issueGiftCard({
      amountCents: totalCents,
      currency: (e.gift_currency as string | null) ?? "usd",
      recipientEmail: e.gift_recipient_email as string,
      recipientName: (e.gift_recipient_name as string | null) ?? undefined,
      note: `A group gift from everyone in "${e.title}" 🎉`,
      idempotencyKey: e.id as string,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    await admin
      .from("engagements")
      .update({ gift_issued_at: new Date().toISOString(), gift_order_id: result.orderId })
      .eq("id", engagementId);

    return NextResponse.json({ ok: true, sentCents: totalCents });
  } catch (e) {
    console.error("Gift send error:", e);
    return NextResponse.json({ error: "Send failed." }, { status: 500 });
  }
}
