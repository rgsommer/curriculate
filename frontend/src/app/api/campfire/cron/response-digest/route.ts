import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  campfireFrom,
  mailDefaults,
  responseDigestEmail,
} from "@/lib/campfire/serverInvites";
import { resolveTitle, engagementIcon } from "@/lib/campfire/types";

const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel strips inbound x-vercel-* headers from external callers, so its presence
// proves a genuine cron invocation. A CRON_SECRET bearer also works.
function authorized(req: Request) {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

// Daily: email each member a recap of new responses in their groups (counts only,
// so nothing sealed leaks). Skipped for groups whose host turned the digest off,
// and never tells a surprise card's recipient about their own card.
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey);
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
  const from = campfireFrom();

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1. Responses from the last day.
  const { data: recent } = await admin
    .from("responses")
    .select("engagement_id, user_id, created_at")
    .gte("created_at", sinceIso);
  if (!recent || recent.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // Unique responders per engagement (one response per user, but be safe).
  const respondersByEng = new Map<string, Set<string>>();
  for (const r of recent) {
    const eid = r.engagement_id as string;
    if (!respondersByEng.has(eid)) respondersByEng.set(eid, new Set());
    respondersByEng.get(eid)!.add(r.user_id as string);
  }

  // 2. The engagements involved.
  const { data: engs } = await admin
    .from("engagements")
    .select("id, group_id, title, type, config, excluded_user_ids, birth_year, deadline")
    .in("id", Array.from(respondersByEng.keys()));
  const engById = new Map((engs ?? []).map((e) => [e.id as string, e]));

  // 3. Their groups — only those with the digest still on.
  const groupIds = Array.from(
    new Set((engs ?? []).map((e) => e.group_id as string))
  );
  const { data: groups } = await admin
    .from("groups")
    .select("id, name, avatar_emoji, notify_on_response")
    .in("id", groupIds);
  const groupById = new Map(
    (groups ?? [])
      .filter((g) => g.notify_on_response !== false)
      .map((g) => [g.id as string, g])
  );
  if (groupById.size === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // 4. Members of those groups.
  const { data: members } = await admin
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", Array.from(groupById.keys()));

  // 5. Per-member digest: which engagements in their groups had responses by OTHERS.
  type Item = { title: string; icon: string; count: number };
  const perMember = new Map<string, Map<string, Item[]>>(); // userId -> groupId -> items
  for (const m of members ?? []) {
    const uid = m.user_id as string;
    const gid = m.group_id as string;
    respondersByEng.forEach((responders, eid) => {
      const eng = engById.get(eid);
      if (!eng || (eng.group_id as string) !== gid) return;
      // Surprise protection: never tell the recipient about their own card.
      const excluded = (eng.excluded_user_ids as string[] | null) ?? [];
      if (excluded.includes(uid)) return;
      const others = Array.from(responders).filter((r) => r !== uid).length;
      if (others <= 0) return;
      if (!perMember.has(uid)) perMember.set(uid, new Map());
      const byGroup = perMember.get(uid)!;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push({
        title: resolveTitle(
          eng.title as string,
          eng.birth_year as number | null,
          eng.deadline as string | null
        ),
        icon: engagementIcon({
          type: eng.type as string,
          config: eng.config as { occasion?: string } | null,
        }),
        count: others,
      });
    });
  }

  // 6. Resolve emails + build messages (guests have no email → skipped).
  const entries = Array.from(perMember.entries()).filter(
    ([, byGroup]) => byGroup.size > 0
  );
  const built = await Promise.all(
    entries.map(async ([uid, byGroup]) => {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      if (!email) return null;
      const recipientName =
        (u?.user?.user_metadata?.display_name as string | undefined) ?? null;
      const groupsPayload = Array.from(byGroup.entries()).map(([gid, items]) => {
        const g = groupById.get(gid)!;
        return {
          name: g.name as string,
          emoji: g.avatar_emoji as string,
          items,
        };
      });
      const em = responseDigestEmail({
        recipientName,
        url: `${base}/campfirelive`,
        groups: groupsPayload,
      });
      return {
        from,
        to: [email],
        subject: em.subject,
        text: em.text,
        html: em.html,
        ...mailDefaults(),
      };
    })
  );
  const msgs = built.filter((m): m is NonNullable<typeof m> => m !== null);

  let sent = 0;
  for (let i = 0; i < msgs.length; i += 100) {
    const { error } = await resend.batch.send(msgs.slice(i, i + 100));
    if (error) {
      console.error("Campfire digest send error:", error);
      break;
    }
    sent += msgs.slice(i, i + 100).length;
  }

  return NextResponse.json({ ok: true, sent, candidates: msgs.length });
}
