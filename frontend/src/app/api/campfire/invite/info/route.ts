import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveTitle } from "@/lib/campfire/types";

// Public lookup for the join page: does this invite code exist, and what is it for?
// Lets the page say "Join 🎉 Family · hosted by Dad" and catch a bad/expired code
// BEFORE it creates a guest account. Returns only what the code holder is about to
// see anyway (group name, emoji, host's display name, card title).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams;
  const code = (qs.get("code") || "").trim();
  const engId = (qs.get("e") || "").trim();
  // Invite codes are alphanumeric; anything else can't match (and keeps ilike safe).
  if (!/^[A-Za-z0-9]{4,32}$/.test(code)) {
    return NextResponse.json({ ok: false });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }
  const admin = createClient(url, serviceKey);

  const { data: group } = await admin
    .from("groups")
    .select("id, name, avatar_emoji, creator_id")
    .ilike("invite_code", code)
    .maybeSingle();
  if (!group) return NextResponse.json({ ok: false });

  const [{ data: gm }, { data: prof }] = await Promise.all([
    admin
      .from("group_members")
      .select("display_name")
      .eq("group_id", group.id)
      .eq("user_id", group.creator_id)
      .maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", group.creator_id).maybeSingle(),
  ]);
  const host = (gm?.display_name as string | null) || (prof?.display_name as string | null) || null;

  // Card-scoped link (?e=…): the engagement must belong to this group.
  let card: { title: string } | null = null;
  if (engId) {
    if (!/^[0-9a-f-]{36}$/i.test(engId)) return NextResponse.json({ ok: false });
    const { data: eng } = await admin
      .from("engagements")
      .select("group_id, title, birth_year, deadline")
      .eq("id", engId)
      .maybeSingle();
    if (!eng || eng.group_id !== group.id) return NextResponse.json({ ok: false });
    card = {
      title: resolveTitle(
        eng.title as string,
        eng.birth_year as number | null,
        eng.deadline as string | null
      ),
    };
  }

  return NextResponse.json({
    ok: true,
    group: { name: group.name as string, emoji: (group.avatar_emoji as string) || "🔥", host },
    card,
  });
}
