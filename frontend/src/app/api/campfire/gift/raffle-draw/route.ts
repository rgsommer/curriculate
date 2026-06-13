import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { raffleOf } from "@/lib/campfire/types";
import { runRaffleDraw } from "@/lib/campfire/raffleDraw";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Host draws the raffle winner now ("declare it at dinner"). The actual draw + payout
// + announcement live in runRaffleDraw, shared with the cron auto-draw backstop.
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
      .select("id, group_id, creator_id, title, config, gift_currency, gift_issued_at")
      .eq("id", engagementId)
      .single();
    if (!eng) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (eng.creator_id !== uid) {
      return NextResponse.json({ error: "Only the host can draw." }, { status: 403 });
    }
    if (!raffleOf(eng.config as Record<string, unknown> | null)?.draw) {
      return NextResponse.json({ error: "Not a raffle draw." }, { status: 400 });
    }

    const result = await runRaffleDraw(admin, {
      id: eng.id as string,
      group_id: eng.group_id as string,
      creator_id: eng.creator_id as string,
      title: eng.title as string,
      config: eng.config as Record<string, unknown> | null,
      gift_currency: eng.gift_currency as string | null,
      gift_issued_at: eng.gift_issued_at as string | null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Draw failed." }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("Raffle draw error:", e);
    return NextResponse.json({ error: "Couldn't draw the winner." }, { status: 500 });
  }
}
