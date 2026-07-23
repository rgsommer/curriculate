import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  campfireFrom,
  mailDefaults,
  activityDigestEmail,
  campfireSiteUrl,
} from "@/lib/campfire/serverInvites";
import { resolveTitle, engagementIcon } from "@/lib/campfire/types";
import { createPushSender } from "@/lib/campfire/push";
import { sendCampfireBatch } from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel strips inbound x-vercel-* headers from external callers, so its presence
// proves a genuine cron invocation. A CRON_SECRET bearer also works.
function authorized(req: Request) {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

// Daily digest. Members get a recap of new responses in their groups (when the
// member digest is on). The HOST of each group also gets a recap of EVERYTHING —
// new responses, new members, new activities — gated by their own notify_host flag,
// independent of the member digest. Counts/titles/names only (no sealed content),
// and a surprise card's recipient is never told about their own card.
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
  const base = campfireSiteUrl();
  const from = campfireFrom();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── Gather the day's activity ──

  // Responses → unique responders per engagement.
  const { data: recentResp } = await admin
    .from("responses")
    .select("engagement_id, user_id, created_at")
    .gte("created_at", sinceIso);
  const respondersByEng = new Map<string, Set<string>>();
  for (const r of recentResp ?? []) {
    const eid = r.engagement_id as string;
    if (!respondersByEng.has(eid)) respondersByEng.set(eid, new Set());
    respondersByEng.get(eid)!.add(r.user_id as string);
  }

  // New members who joined a group today.
  const { data: recentJoins } = await admin
    .from("group_members")
    .select("group_id, user_id, display_name, created_at")
    .gte("created_at", sinceIso);
  const newMembersByGroup = new Map<string, { uid: string; name: string | null }[]>();
  for (const m of recentJoins ?? []) {
    const gid = m.group_id as string;
    if (!newMembersByGroup.has(gid)) newMembersByGroup.set(gid, []);
    newMembersByGroup
      .get(gid)!
      .push({ uid: m.user_id as string, name: (m.display_name as string | null) ?? null });
  }

  // Engagements launched today.
  const { data: newEngRows } = await admin
    .from("engagements")
    .select("id, group_id, title, type, config, creator_id, birth_year, deadline")
    .gte("launched_at", sinceIso);
  const newEngByGroup = new Map<
    string,
    { creator_id: string; title: string; icon: string }[]
  >();
  for (const e of newEngRows ?? []) {
    const gid = e.group_id as string;
    if (!newEngByGroup.has(gid)) newEngByGroup.set(gid, []);
    newEngByGroup.get(gid)!.push({
      creator_id: e.creator_id as string,
      title: resolveTitle(
        e.title as string,
        e.birth_year as number | null,
        e.deadline as string | null
      ),
      icon: engagementIcon({
        type: e.type as string,
        config: e.config as { occasion?: string } | null,
      }),
    });
  }

  // Engagements that received responses (for the responses section metadata).
  const { data: respEngs } = await admin
    .from("engagements")
    .select("id, group_id, title, type, config, excluded_user_ids, birth_year, deadline")
    .in("id", Array.from(respondersByEng.keys()));
  const engById = new Map((respEngs ?? []).map((e) => [e.id as string, e]));

  // ── Groups touched today (any of the three activity kinds) ──
  const activeGroupIds = Array.from(
    new Set(
      (respEngs ?? [])
        .map((e) => e.group_id as string)
        .concat(Array.from(newMembersByGroup.keys()))
        .concat(Array.from(newEngByGroup.keys()))
    )
  );
  if (activeGroupIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }
  const { data: groups } = await admin
    .from("groups")
    .select("id, name, avatar_emoji, creator_id, notify_on_response, notify_host")
    .in("id", activeGroupIds);
  const groupById = new Map((groups ?? []).map((g) => [g.id as string, g]));

  const { data: members } = await admin
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", activeGroupIds);

  // Resolve display names for the new joiners (per-group name, else profile).
  const joinerIds = Array.from(
    new Set((recentJoins ?? []).map((m) => m.user_id as string))
  );
  const nameById = new Map<string, string>();
  if (joinerIds.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", joinerIds);
    for (const p of profs ?? [])
      nameById.set(p.id as string, (p.display_name as string) || "");
  }
  const joinerName = (uid: string, perGroupName: string | null) =>
    (perGroupName && perGroupName.trim()) ||
    nameById.get(uid) ||
    "Someone new";

  // ── Build a per-user digest ──
  type Resp = { title: string; icon: string; count: number };
  type GroupPayload = {
    responses: Resp[];
    newMembers: string[];
    newEngagements: { title: string; icon: string }[];
  };
  const perUser = new Map<string, Map<string, GroupPayload>>(); // uid -> gid -> payload

  for (const m of members ?? []) {
    const uid = m.user_id as string;
    const gid = m.group_id as string;
    const group = groupById.get(gid);
    if (!group) continue;
    const isHost = (group.creator_id as string) === uid;
    const eligible = isHost
      ? group.notify_host !== false
      : group.notify_on_response !== false;
    if (!eligible) continue;

    // Responses by OTHERS (both host + members), skipping surprise recipients.
    const responses: Resp[] = [];
    respondersByEng.forEach((responders, eid) => {
      const eng = engById.get(eid);
      if (!eng || (eng.group_id as string) !== gid) return;
      const excluded = (eng.excluded_user_ids as string[] | null) ?? [];
      if (excluded.includes(uid)) return;
      const others = Array.from(responders).filter((r) => r !== uid).length;
      if (others <= 0) return;
      responses.push({
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

    // Host-only: new members + new activities (created by someone other than them).
    let newMembers: string[] = [];
    let newEngagements: { title: string; icon: string }[] = [];
    if (isHost) {
      newMembers = (newMembersByGroup.get(gid) ?? [])
        .filter((j) => j.uid !== uid)
        .map((j) => joinerName(j.uid, j.name));
      newEngagements = (newEngByGroup.get(gid) ?? [])
        .filter((e) => e.creator_id !== uid)
        .map((e) => ({ title: e.title, icon: e.icon }));
    }

    if (responses.length || newMembers.length || newEngagements.length) {
      if (!perUser.has(uid)) perUser.set(uid, new Map());
      perUser.get(uid)!.set(gid, { responses, newMembers, newEngagements });
    }
  }

  // ── Send (email + native push) ──
  const pushSend = await createPushSender(); // null when FCM isn't configured
  let pushed = 0;
  const entries = Array.from(perUser.entries()).filter(
    ([, byGroup]) => byGroup.size > 0
  );
  const built = await Promise.all(
    entries.map(async ([uid, byGroup]) => {
      const groupsPayload = Array.from(byGroup.entries()).map(([gid, p]) => {
        const g = groupById.get(gid)!;
        return {
          name: g.name as string,
          emoji: g.avatar_emoji as string,
          responses: p.responses,
          newMembers: p.newMembers,
          newEngagements: p.newEngagements,
        };
      });
      const events = groupsPayload.reduce(
        (a, g) =>
          a +
          g.responses.reduce((b, r) => b + r.count, 0) +
          g.newMembers.length +
          g.newEngagements.length,
        0
      );

      // Native push to this user's devices (best-effort, only if FCM is set up).
      if (pushSend) {
        const { data: toks } = await admin
          .from("campfire_push_tokens")
          .select("token")
          .eq("user_id", uid);
        for (const t of toks ?? []) {
          const ok = await pushSend(t.token as string, {
            title: "🔥 Campfire",
            body: `${events} new thing${events === 1 ? "" : "s"} in your group${
              groupsPayload.length === 1 ? "" : "s"
            }`,
            link: `${base}/campfirelive`,
          });
          if (ok) pushed++;
        }
      }

      const { data: u } = await admin.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      if (!email) return null; // guests (anonymous) have no email
      const recipientName =
        (u?.user?.user_metadata?.display_name as string | undefined) ?? null;
      const em = activityDigestEmail({
        recipientName,
        url: `${base}/campfirelive`,
        unsubUrl: `${base}/campfire/unsubscribe?e=${encodeURIComponent(email)}`,
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
    const { error } = await sendCampfireBatch(msgs.slice(i, i + 100));
    if (error) {
      console.error("Campfire digest send error:", error);
      break;
    }
    sent += msgs.slice(i, i + 100).length;
  }

  return NextResponse.json({ ok: true, sent, pushed, candidates: msgs.length });
}
