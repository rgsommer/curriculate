import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { issueGiftCard } from "@/lib/campfire/gifts";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Manually send a pooled Sign-up chip-in now (a Sign-up never auto-reveals). The
// engagement's host OR whoever started this chip-in may trigger it. Idempotent.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const giftId = typeof body?.giftId === "string" ? body.giftId : "";
    if (!giftId) {
      return NextResponse.json({ error: "Missing gift." }, { status: 400 });
    }
    const admin = getAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: g } = await admin
      .from("campfire_gifts")
      .select(
        "id, engagement_id, initiated_by, issued_at, recipient_email, recipient_name, currency"
      )
      .eq("id", giftId)
      .single();
    if (!g) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // Auth: the engagement's creator, or whoever started this chip-in.
    const { data: eng } = await admin
      .from("engagements")
      .select("creator_id, title")
      .eq("id", g.engagement_id)
      .single();
    if (uid !== eng?.creator_id && uid !== g.initiated_by) {
      return NextResponse.json(
        { error: "Only the host or whoever started the chip-in can send it." },
        { status: 403 }
      );
    }
    if (!g.recipient_email) {
      return NextResponse.json({ error: "No recipient set." }, { status: 400 });
    }
    if (g.issued_at) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    const { data: contribs } = await admin
      .from("campfire_gift_contributions")
      .select("amount_cents")
      .eq("gift_id", giftId)
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
      currency: (g.currency as string | null) ?? "usd",
      recipientEmail: g.recipient_email as string,
      recipientName: (g.recipient_name as string | null) ?? undefined,
      note: `A group gift from everyone in "${eng?.title ?? "the group"}" 🎉`,
      idempotencyKey: g.id as string,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    await admin
      .from("campfire_gifts")
      .update({ issued_at: new Date().toISOString(), order_id: result.orderId })
      .eq("id", giftId);

    return NextResponse.json({ ok: true, sentCents: totalCents });
  } catch (e) {
    console.error("Gift send error:", e);
    return NextResponse.json({ error: "Send failed." }, { status: 500 });
  }
}
