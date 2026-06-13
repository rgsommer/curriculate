import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// The recipient opened their revealed card — stamp config.cardViewedAt once so the
// host can see it landed. Only the card's recipient (an excluded surprise user) may
// set it. Idempotent.
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
      .select("excluded_user_ids, config, status, type")
      .eq("id", engagementId)
      .single();
    if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const isRecipient = ((e.excluded_user_ids as string[]) ?? []).includes(uid);
    if (!isRecipient) {
      // Not the recipient — nothing to record, but not an error.
      return NextResponse.json({ ok: true, skipped: "not recipient" });
    }
    const cfg = (e.config ?? {}) as Record<string, unknown>;
    if (cfg.cardViewedAt) {
      return NextResponse.json({ ok: true, alreadyViewed: true });
    }
    await admin
      .from("engagements")
      .update({ config: { ...cfg, cardViewedAt: new Date().toISOString() } })
      .eq("id", engagementId);
    return NextResponse.json({ ok: true, viewed: true });
  } catch (e) {
    console.error("Card viewed error:", e);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
