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
      last30d: { engagements: engagements30d, responses: responses30d },
      revealRate: engagements ? Math.round((revealed / engagements) * 100) : 0,
      inviteConversion: invites ? Math.round((invitesJoined / invites) * 100) : 0,
      recentGroups: recentGroups || [],
    });
  } catch (err) {
    console.error("[admin/campfire-stats] error", err);
    return NextResponse.json({ error: "stats_failed" }, { status: 500 });
  }
}
