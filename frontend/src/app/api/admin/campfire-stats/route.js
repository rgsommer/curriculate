import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Campfire lives in Supabase (separate from the Mongo backend the other admin
// panels use), so this route reads it directly with the service-role key.
// Gated by the same x-admin-token the admin page already sends.
async function authorize(req) {
  const provided = (
    req.headers.get("x-admin-token") ||
    new URL(req.url).searchParams.get("key") ||
    ""
  ).trim();
  if (!provided) return false;
  // Accept the frontend's own admin token...
  const local = String(process.env.ADMIN_API_TOKEN || "").trim();
  if (local && provided === local) return true;
  // ...or any token the backend admin accepts (matches how the rest of /admin
  // trusts the operator — the admin page's stored token validates there).
  try {
    const base = String(
      process.env.BACKEND_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        "https://api.curriculate.net"
    ).replace(/\/$/, "");
    const r = await fetch(`${base}/admin/diagnostics?limit=1`, {
      headers: { "x-admin-token": provided, accept: "application/json" },
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function GET(req) {
  try {
    if (!(await authorize(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }
    const sb = createClient(url, key);

    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const headCount = async (table, mod) => {
      let q = sb.from(table).select("*", { count: "exact", head: true });
      if (mod) q = mod(q);
      const { count, error } = await q;
      if (error) return 0;
      return count ?? 0;
    };

    const [
      users,
      groups,
      engagements,
      revealed,
      active,
      responses,
      newGroups7d,
      newEngagements7d,
      invites,
      invitesJoined,
      engagements30d,
      responses30d,
    ] = await Promise.all([
      headCount("profiles"),
      headCount("groups"),
      headCount("engagements"),
      headCount("engagements", (q) => q.eq("status", "revealed")),
      headCount("engagements", (q) => q.eq("status", "active")),
      headCount("responses"),
      headCount("groups", (q) => q.gte("created_at", since7)),
      headCount("engagements", (q) => q.gte("created_at", since7)),
      headCount("campfire_invitations"),
      headCount("campfire_invitations", (q) => q.eq("status", "joined")),
      headCount("engagements", (q) => q.gte("created_at", since30)),
      headCount("responses", (q) => q.gte("created_at", since30)),
    ]);

    // ── Detail: users, per-group engagement, engagement-level metrics ──
    const [
      { data: profileRows },
      authRes,
      { data: groupRows },
      { data: memberRows },
      { data: engRows },
      { data: respRows },
    ] = await Promise.all([
      sb.from("profiles").select("id, display_name, created_at").order("created_at", { ascending: false }).limit(50),
      sb.auth.admin.listUsers({ page: 1, perPage: 200 }),
      sb.from("groups").select("id, name, avatar_emoji, created_at").order("created_at", { ascending: false }),
      sb.from("group_members").select("group_id"),
      sb.from("engagements").select("id, group_id, status, total_expected"),
      sb.from("responses").select("engagement_id"),
    ]);

    const emailById = {};
    for (const u of authRes?.data?.users || []) emailById[u.id] = u.email || "";

    const usersList = (profileRows || []).slice(0, 25).map((p) => ({
      name: p.display_name,
      email: emailById[p.id] || "",
      created_at: p.created_at,
    }));

    const membersByGroup = {};
    for (const m of memberRows || []) membersByGroup[m.group_id] = (membersByGroup[m.group_id] || 0) + 1;
    const engByGroup = {};
    const engToGroup = {};
    let sumExpected = 0;
    for (const e of engRows || []) {
      engByGroup[e.group_id] = (engByGroup[e.group_id] || 0) + 1;
      engToGroup[e.id] = e.group_id;
      sumExpected += e.total_expected || 0;
    }
    const respByGroup = {};
    for (const r of respRows || []) {
      const g = engToGroup[r.engagement_id];
      if (g) respByGroup[g] = (respByGroup[g] || 0) + 1;
    }

    const groupsDetail = (groupRows || []).map((g) => ({
      name: g.name,
      emoji: g.avatar_emoji,
      members: membersByGroup[g.id] || 0,
      engagements: engByGroup[g.id] || 0,
      responses: respByGroup[g.id] || 0,
      created_at: g.created_at,
    }));

    const activeGroups = groupsDetail.filter((g) => g.engagements > 0).length;

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      totals: {
        users,
        groups,
        engagements,
        responses,
        revealed,
        active,
        invites,
        invitesJoined,
      },
      last7d: { newGroups: newGroups7d, newEngagements: newEngagements7d },
      last30d: { engagements: engagements30d, responses: responses30d },
      revealRate: engagements ? Math.round((revealed / engagements) * 100) : 0,
      inviteConversion: invites ? Math.round((invitesJoined / invites) * 100) : 0,
      engagement: {
        activeGroups,
        responseRate: sumExpected ? Math.round((responses / sumExpected) * 100) : 0,
        avgEngagementsPerGroup: groups ? Math.round((engagements / groups) * 10) / 10 : 0,
        avgResponsesPerEngagement: engagements ? Math.round((responses / engagements) * 10) / 10 : 0,
      },
      usersList,
      groupsDetail,
      recentGroups: (groupRows || []).slice(0, 8).map((g) => ({
        name: g.name,
        avatar_emoji: g.avatar_emoji,
        created_at: g.created_at,
      })),
    });
  } catch (err) {
    console.error("[admin/campfire-stats] error", err);
    return NextResponse.json({ error: "stats_failed" }, { status: 500 });
  }
}
