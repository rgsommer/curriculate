import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Host setting: let Campfire suggest ideas to a few members when this group goes quiet
// (see cron/dormant-groups). Stored on the group creator's app_metadata
// (cf_nudge_off_groups) — on by default. Readable/changeable by the creator or a co-host.

async function ctx(req: Request, groupId: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !groupId) return null;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { data: who } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const uid = who?.user?.id;
  if (!uid) return null;
  const { data: g } = await admin.from("groups").select("creator_id").eq("id", groupId).maybeSingle();
  if (!g) return null;
  if (g.creator_id !== uid) {
    const { data: m } = await admin
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (m?.role !== "admin") return null;
  }
  const { data: host } = await admin.auth.admin.getUserById(g.creator_id as string);
  const meta = (host?.user?.app_metadata as Record<string, unknown>) ?? {};
  return { admin, hostId: g.creator_id as string, meta };
}

export async function GET(req: Request) {
  const groupId = new URL(req.url).searchParams.get("groupId") ?? "";
  const c = await ctx(req, groupId);
  if (!c) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const off = ((c.meta.cf_nudge_off_groups as string[] | undefined) ?? []).includes(groupId);
  return NextResponse.json({ on: !off });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const on = body?.on !== false;
  const c = await ctx(req, groupId);
  if (!c) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const cur = new Set((c.meta.cf_nudge_off_groups as string[] | undefined) ?? []);
  if (on) cur.delete(groupId);
  else cur.add(groupId);
  const { error } = await c.admin.auth.admin.updateUserById(c.hostId, {
    app_metadata: { ...c.meta, cf_nudge_off_groups: Array.from(cur) },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ on });
}
