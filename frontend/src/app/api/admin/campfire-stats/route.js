import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Campfire lives in Supabase (separate from the Mongo backend the other admin
// panels use), so this route reads it directly with the service-role key.
// Gated by the same x-admin-token the admin page already sends.
export async function GET(req) {
  try {
    const expected = String(process.env.ADMIN_API_TOKEN || "").trim();
    const provided =
      req.headers.get("x-admin-token") ||
      new URL(req.url).searchParams.get("key") ||
      "";
    if (!expected || provided !== expected) {
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
    ]);

    const { data: recentGroups } = await sb
      .from("groups")
      .select("name, avatar_emoji, created_at")
      .order("created_at", { ascending: false })
      .limit(8);

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
      revealRate: engagements ? Math.round((revealed / engagements) * 100) : 0,
      inviteConversion: invites ? Math.round((invitesJoined / invites) * 100) : 0,
      recentGroups: recentGroups || [],
    });
  } catch (err) {
    console.error("[admin/campfire-stats] error", err);
    return NextResponse.json({ error: "stats_failed" }, { status: 500 });
  }
}
