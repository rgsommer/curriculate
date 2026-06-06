import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  getNonResponderEmails,
  getGroupMemberEmails,
  reminderEmail,
  revealEmail,
  buildJoinUrl,
  inviteEmail,
  mailDefaults,
  campfireFrom,
} from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

const GRACE_MS = 24 * 60 * 60 * 1000; // nudge for 24h past the deadline, then reveal
const NUDGE_THROTTLE_MS = 20 * 60 * 60 * 1000; // at most ~once a day per engagement

// Vercel strips inbound x-vercel-* headers from external callers, so its
// presence proves a genuine cron invocation. A CRON_SECRET bearer also works.
function authorized(req: Request) {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

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
  const now = Date.now();

  const { data: engs } = await admin
    .from("engagements")
    .select("id, group_id, title, total_expected, deadline, reveal, deadline_nudged_at, hold_until_deadline")
    .eq("status", "active")
    .not("deadline", "is", null);

  let revealed = 0;
  let nudged = 0;

  for (const e of engs ?? []) {
    const dl = new Date(e.deadline as string).getTime();

    // "Hold until deadline" engagements reveal AT the deadline regardless of how
    // many responded — that's the whole point of waiting for the date.
    if (e.hold_until_deadline && now >= dl) {
      await admin.from("engagements").update({ status: "revealed" }).eq("id", e.id);
      revealed++;
      continue;
    }

    // Past the grace window → reveal with whoever's in, so it never freezes.
    if (now > dl + GRACE_MS) {
      await admin.from("engagements").update({ status: "revealed" }).eq("id", e.id);
      revealed++;
      continue;
    }

    // Within the window (24h before deadline through grace): nudge the people we
    // can reach — non-responding members + still-pending invitees. Throttled.
    if (now > dl - GRACE_MS) {
      const lastNudge = e.deadline_nudged_at
        ? new Date(e.deadline_nudged_at as string).getTime()
        : 0;
      if (now - lastNudge < NUDGE_THROTTLE_MS) continue;

      const { count } = await admin
        .from("responses")
        .select("*", { count: "exact", head: true })
        .eq("engagement_id", e.id);
      const memberEmails = await getNonResponderEmails(admin, e.id as string, e.group_id as string);
      const { data: pend } = await admin
        .from("campfire_invitations")
        .select("email")
        .eq("group_id", e.group_id)
        .eq("status", "pending");
      const { data: group } = await admin
        .from("groups")
        .select("name, invite_code, avatar_emoji")
        .eq("id", e.group_id)
        .single();

      const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
      const messages: {
        from: string;
        to: string[];
        subject: string;
        text: string;
        html: string;
      }[] = [];

      if (memberEmails.length) {
        const m = reminderEmail({
          groupName: group?.name ?? "your group",
          title: e.title as string,
          url: engUrl,
          responded: count ?? 0,
          total: (e.total_expected as number) ?? 0,
        });
        for (const to of memberEmails) {
          messages.push({ from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults() });
        }
      }
      if (pend?.length && group) {
        const joinUrl = buildJoinUrl(base, group.invite_code);
        const inv = inviteEmail({
          inviter: "Your group",
          groupName: group.name,
          groupEmoji: group.avatar_emoji,
          inviteCode: group.invite_code,
          joinUrl,
          nudge: true,
        });
        for (const p of pend) {
          messages.push({ from, to: [p.email], subject: inv.subject, text: inv.text, html: inv.html, ...mailDefaults() });
        }
      }

      if (messages.length) {
        // Resend batch caps at 100; chunk to be safe.
        for (let i = 0; i < messages.length; i += 100) {
          await resend.batch.send(messages.slice(i, i + 100));
        }
        await admin
          .from("engagements")
          .update({ deadline_nudged_at: new Date(now).toISOString() })
          .eq("id", e.id);
        nudged++;
      }
    }
  }

  // ── Recurring: spawn the next instance for completed recurring engagements ──
  let spawned = 0;
  const { data: recs } = await admin
    .from("engagements")
    .select(
      "id, group_id, creator_id, type, title, description, config, reveal, is_blind, recurrence_rule, created_at"
    )
    .not("recurrence_rule", "is", null)
    .in("status", ["revealed", "expired"]);

  for (const e of recs ?? []) {
    // Only the tail of a chain spawns (skip if it already has a child).
    const { count: childCount } = await admin
      .from("engagements")
      .select("*", { count: "exact", head: true })
      .eq("parent_id", e.id);
    if (childCount && childCount > 0) continue;

    const DAY = 24 * 60 * 60 * 1000;
    const intervalMs =
      e.recurrence_rule === "weekly"
        ? 7 * DAY
        : e.recurrence_rule === "monthly"
        ? 30 * DAY
        : DAY;
    if (now < new Date(e.created_at as string).getTime() + intervalMs) continue;

    await admin.from("engagements").insert({
      group_id: e.group_id,
      creator_id: e.creator_id,
      type: e.type,
      title: e.title,
      description: e.description,
      config: e.config,
      reveal: e.reveal,
      is_blind: e.is_blind,
      recurrence_rule: e.recurrence_rule,
      parent_id: e.id,
      status: "active",
      // Auto-posted, so it's live immediately (not a draft) and members see it.
      launched_at: new Date(now).toISOString(),
      notify: true,
      deadline: new Date(now + intervalMs).toISOString(),
    });
    spawned++;
  }

  // ── Reveal emails: notify members of newly-revealed engagements that opted in ──
  let notifiedReveals = 0;
  const { data: toNotify } = await admin
    .from("engagements")
    .select("id, group_id, title")
    .eq("status", "revealed")
    .is("reveal_notified_at", null);

  for (const e of toNotify ?? []) {
    const emails = await getGroupMemberEmails(admin, e.group_id);
    if (emails.length) {
      const { data: group } = await admin
        .from("groups")
        .select("name")
        .eq("id", e.group_id)
        .single();
      const m = revealEmail({
        groupName: group?.name ?? "your group",
        title: e.title,
        url: `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`,
      });
      for (let i = 0; i < emails.length; i += 100) {
        await resend.batch.send(
          emails.slice(i, i + 100).map((to) => ({
            from,
            to: [to],
            subject: m.subject,
            text: m.text,
            html: m.html,
            ...mailDefaults(),
          }))
        );
      }
    }
    await admin
      .from("engagements")
      .update({ reveal_notified_at: new Date(now).toISOString() })
      .eq("id", e.id);
    notifiedReveals++;
  }

  return NextResponse.json({ ok: true, revealed, nudged, spawned, notifiedReveals });
}
