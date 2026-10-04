import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  campfireFrom,
  dormantNudgeEmail,
  mailDefaults,
  sendCampfireBatch,
} from "@/lib/campfire/serverInvites";
import { pushToUsers } from "@/lib/campfire/push";
import {
  NUDGE_GROUP_EVERY_DAYS,
  NUDGE_MAX_PER_GROUP,
  NUDGE_MEMBER_EVERY_DAYS,
  NUDGE_QUIET_DAYS,
  NUDGE_SHARE,
  dormantSuggestion,
  groupKind,
  nudgeSig,
  suggestionUrl,
  type NudgeMeta,
} from "@/lib/campfire/nudges";

// Daily. For each group that's gone quiet (no responses and no new activity for
// NUDGE_QUIET_DAYS), ask ~5–10% of its members — never the host — to start one
// specific seasonal thing, via email + push. A group is nudged at most monthly, a
// person at most quarterly, and both the host (per group) and the member (for good)
// can switch it off. ?preview=1 (auth'd) returns the plan without sending.

const DAY = 86400000;
const MAX_EMAILS_PER_RUN = 60;

function authorized(req: Request) {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  const site = (process.env.CAMPFIRE_PUBLIC_URL || "https://www.curriculate.net").replace(/\/$/, "");
  const now = Date.now();
  const quietSince = new Date(now - NUDGE_QUIET_DAYS * DAY).toISOString();

  const { data: groups } = await admin
    .from("groups")
    .select("id, name, description, school, creator_id, created_at");

  // auth users are fetched once each (members can share several groups).
  const userCache = new Map<string, { email: string | null; meta: Record<string, unknown> }>();
  const getUser = async (uid: string) => {
    if (userCache.has(uid)) return userCache.get(uid)!;
    const { data } = await admin.auth.admin.getUserById(uid);
    const v = {
      email: data?.user?.email ?? null,
      meta: (data?.user?.app_metadata as Record<string, unknown>) ?? {},
    };
    userCache.set(uid, v);
    return v;
  };

  const plan: Array<{ group: string; members: number; picked: string[]; idea: string; skipped?: string }> = [];
  let emailsSent = 0;

  for (const g of groups ?? []) {
    if (emailsSent >= MAX_EMAILS_PER_RUN) break;
    const gid = g.id as string;
    const log = (skipped: string) => plan.push({ group: g.name as string, members: 0, picked: [], idea: "", skipped });
    // Give a brand-new group time to get going on its own.
    if (new Date(g.created_at as string).getTime() > now - 21 * DAY) { log("new group"); continue; }

    const { data: members } = await admin
      .from("group_members")
      .select("user_id, display_name, notify_email")
      .eq("group_id", gid);
    const others = ((members ?? []) as { user_id: string; display_name: string | null; notify_email: string | null }[])
      .filter((m) => m.user_id !== g.creator_id);
    if (others.length < 2) { log("fewer than 2 members besides the host"); continue; }

    // Quiet = no NEW activity (a fresh, non-recurring start) and no responses lately.
    // Recurring check-ins re-spawn on their own, so their spawns don't count as life.
    const { data: engs } = await admin
      .from("engagements")
      .select("id, created_at, parent_id")
      .eq("group_id", gid);
    const engList = (engs ?? []) as { id: string; created_at: string; parent_id: string | null }[];
    if (engList.some((e) => !e.parent_id && e.created_at > quietSince)) { log("new activity recently"); continue; }
    const engIds = engList.map((e) => e.id);
    let responders = new Set<string>();
    if (engIds.length) {
      const { data: rs } = await admin
        .from("responses")
        .select("user_id, created_at")
        .in("engagement_id", engIds);
      const rows = (rs ?? []) as { user_id: string; created_at: string }[];
      if (rows.some((r) => r.created_at > quietSince)) { log("responses recently"); continue; }
      responders = new Set(rows.map((r) => r.user_id));
    }

    // The host can switch nudges off for this group.
    const host = await getUser(g.creator_id as string);
    const offGroups = (host.meta.cf_nudge_off_groups as string[] | undefined) ?? [];
    if (offGroups.includes(gid)) { log("host turned nudges off"); continue; }

    // At most one round per group per month; at most one ask per person per quarter.
    const people = await Promise.all(
      others.map(async (m) => {
        const u = await getUser(m.user_id);
        return { ...m, email: u.email || m.notify_email, nudge: (u.meta.cf_nudge as NudgeMeta | undefined) ?? {}, meta: u.meta };
      })
    );
    const groupNudgedAt = people
      .filter((p) => p.nudge.group === gid && p.nudge.at)
      .map((p) => new Date(p.nudge.at as string).getTime());
    if (groupNudgedAt.some((t) => t > now - NUDGE_GROUP_EVERY_DAYS * DAY)) { log("nudged this month"); continue; }

    // Respect Campfire-wide email opt-outs before choosing anyone.
    const emails = people.map((p) => p.email?.toLowerCase()).filter(Boolean) as string[];
    const { data: outs } = emails.length
      ? await admin.from("campfire_email_optouts").select("email").in("email", emails)
      : { data: [] };
    const optedOut = new Set(((outs ?? []) as { email: string }[]).map((o) => o.email));
    const eligible = people.filter(
      (p) =>
        !!p.email &&
        !optedOut.has(p.email.toLowerCase()) &&
        !p.nudge.off &&
        !(p.nudge.at && new Date(p.nudge.at).getTime() > now - NUDGE_MEMBER_EVERY_DAYS * DAY)
    );
    if (!eligible.length) { log("no one eligible"); continue; }

    const n = Math.min(NUDGE_MAX_PER_GROUP, Math.max(1, Math.round(others.length * NUDGE_SHARE)));
    // People who've joined in before are likeliest to start something.
    const picked = [
      ...shuffle(eligible.filter((p) => responders.has(p.user_id))),
      ...shuffle(eligible.filter((p) => !responders.has(p.user_id))),
    ].slice(0, n);

    const s = dormantSuggestion(groupKind({ name: g.name as string, school: g.school as string | null, description: g.description as string | null }));
    const url = suggestionUrl(site, gid, s);
    plan.push({ group: g.name as string, members: others.length, picked: picked.map((p) => p.display_name || "member"), idea: s.idea });
    if (preview) continue;

    // Claim first (stamp), then send — a rerun can't double-send.
    const stampedAt = new Date().toISOString();
    for (const p of picked) {
      await admin.auth.admin.updateUserById(p.user_id, {
        app_metadata: { ...p.meta, cf_nudge: { ...p.nudge, at: stampedAt, group: gid } },
      });
    }
    const from = campfireFrom();
    const msgs = picked.map((p) => {
      const stopUrl = `${site}/api/campfire/nudge-optout?u=${encodeURIComponent(p.user_id)}&s=${nudgeSig(p.user_id)}`;
      const first = (p.display_name || "").trim().split(/\s+/)[0] || null;
      const m = dormantNudgeEmail({
        firstName: first,
        groupName: g.name as string,
        emoji: s.emoji,
        idea: s.idea,
        why: s.why,
        cta: s.cta,
        url,
        stopUrl,
      });
      return { from, to: [p.email as string], subject: m.subject, text: m.text, html: m.html, ...mailDefaults() };
    });
    await sendCampfireBatch(msgs);
    emailsSent += msgs.length;
    await pushToUsers(
      picked.map((p) => p.user_id),
      { title: `${s.emoji} An idea for ${g.name}`, body: `It's been quiet — start ${s.idea} in a minute?`, link: url }
    ).catch(() => 0);
  }

  return NextResponse.json({ ok: true, preview, emailsSent, plan });
}
