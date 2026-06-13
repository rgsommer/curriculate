import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { raffleOf, pledgeOf } from "@/lib/campfire/types";

export const dynamic = "force-dynamic"; // reads the request URL (eid query param)

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Minimal PUBLIC info for the QR contribute page (/campfirelive/give/[id]) — no auth.
// Only returns money-collecting engagements, and only non-sensitive fields, so a QR
// at an event lets a passer-by chip in / donate without joining.
export async function GET(req: Request) {
  try {
    const eid = new URL(req.url).searchParams.get("eid") || "";
    if (!eid) return NextResponse.json({ error: "Missing id." }, { status: 400 });
    const admin = getAdmin();

    const { data: eng } = await admin
      .from("engagements")
      .select(
        "id, group_id, title, type, config, gift_enabled, gift_currency, gift_recipient_name, gift_issued_at"
      )
      .eq("id", eid)
      .single();
    if (!eng) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const raffle = raffleOf(eng.config as Record<string, unknown> | null);
    const pledge = pledgeOf(eng.config as Record<string, unknown> | null);
    const collecting = !!eng.gift_enabled || !!raffle || !!pledge;
    if (!collecting) {
      return NextResponse.json({ error: "Not collecting." }, { status: 400 });
    }

    const { data: group } = await admin
      .from("groups")
      .select("name, avatar_emoji")
      .eq("id", eng.group_id)
      .single();

    // Pot so far (paid only).
    const { data: sums } = await admin
      .from("campfire_gift_contributions")
      .select("amount_cents")
      .eq("engagement_id", eid)
      .eq("status", "paid");
    const potCents = (sums ?? []).reduce(
      (a, c) => a + ((c.amount_cents as number) || 0),
      0
    );

    return NextResponse.json({
      ok: true,
      id: eng.id,
      title: eng.title,
      type: eng.type,
      currency: (eng.gift_currency as string | null) ?? "usd",
      isRaffle: !!raffle,
      isDraw: raffle?.draw === true,
      isPledge: !!pledge,
      recipientName: (eng.gift_recipient_name as string | null) ?? null,
      cause:
        ((eng.config as { cause?: string } | null)?.cause as string | undefined) ??
        null,
      groupName: (group?.name as string | null) ?? null,
      groupEmoji: (group?.avatar_emoji as string | null) ?? "🔥",
      potCents,
      closed: !!eng.gift_issued_at,
    });
  } catch (e) {
    console.error("public-summary error:", e);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
