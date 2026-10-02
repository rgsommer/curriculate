import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// A guest (or member) who joined via a link saves THEIR OWN result-email so contest
// results / reveals reach them. Self-service: verifies the caller's token, then writes
// only the caller's own row — engagement_guests.email for a card/contest guest, or
// group_members.notify_email for a full member. Never touches anyone else.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engId = typeof body?.engId === "string" ? body.engId : "";
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return NextResponse.json({ error: "Not configured." }, { status: 500 });
    const admin = createClient(url, key);

    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    // Engagement guest first (joined via ?e=…), else a full group member.
    if (engId) {
      const { data: g } = await admin
        .from("engagement_guests")
        .select("user_id")
        .eq("engagement_id", engId)
        .eq("user_id", uid)
        .maybeSingle();
      if (g) {
        const { error } = await admin
          .from("engagement_guests")
          .update({ email })
          .eq("engagement_id", engId)
          .eq("user_id", uid);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
    }
    if (groupId) {
      const { data: m } = await admin
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", uid)
        .maybeSingle();
      if (m) {
        const { error } = await admin
          .from("group_members")
          .update({ notify_email: email })
          .eq("group_id", groupId)
          .eq("user_id", uid);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
    }
    return NextResponse.json({ error: "Join first, then add your email." }, { status: 404 });
  } catch (err) {
    console.error("guest notify-email route error:", err);
    return NextResponse.json({ error: "Couldn't save your email." }, { status: 500 });
  }
}
