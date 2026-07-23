import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  authorizeGroupRequester,
  getNonResponderEmails,
  reminderEmail,
  newEngagementEmail,
  buildJoinUrl,
  mailDefaults,
  campfireFrom,
  campfireSiteUrl,
} from "@/lib/campfire/serverInvites";
import { ENGAGEMENT_TYPES, resolveTitle } from "@/lib/campfire/types";
import { sendCampfireBatch } from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

// Manual "Nudge Stragglers": remind everyone who hasn't answered yet — BOTH
// joined members who haven't responded AND people invited who haven't joined.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }
    // Optional one-line personal note from the member sending the nudge.
    const note =
      typeof body?.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 140)
        : undefined;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server not configured." }, { status: 500 });
    }

    const svc = createClient(url, serviceKey);
    const { data: eng } = await svc
      .from("engagements")
      .select(
        "group_id, title, total_expected, birth_year, deadline, hold_until_deadline, type, is_blind, reveal, share_code, excluded_emails, paused, deadline_nudged_at"
      )
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }

    // Paused → no nudges go out.
    if (eng.paused) {
      return NextResponse.json({ ok: true, sent: 0, paused: true });
    }

    const auth = await authorizeGroupRequester(req, eng.group_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    // Digest throttle: at most one reminder per ~20h, shared across every member's
    // nudges AND the automatic deadline nudge (same deadline_nudged_at stamp). So
    // anyone can nudge, but people get a single batched reminder — never a pile-on.
    const THROTTLE_MS = 20 * 60 * 60 * 1000;
    const lastNudge = eng.deadline_nudged_at
      ? new Date(eng.deadline_nudged_at as string).getTime()
      : 0;
    if (Date.now() - lastNudge < THROTTLE_MS) {
      return NextResponse.json({
        ok: true,
        throttled: true,
        nudged: 0,
        nextAt: new Date(lastNudge + THROTTLE_MS).toISOString(),
      });
    }

    const base = campfireSiteUrl();
    const from = campfireFrom();
    const engUrl = `${base}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;
    const engTitle = resolveTitle(
      eng.title,
      eng.birth_year as number | null,
      eng.deadline as string | null
    );

    const { count } = await admin
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagementId);
    const { data: group } = await admin
      .from("groups")
      .select("name, invite_code, avatar_emoji")
      .eq("id", eng.group_id)
      .single();

    let nudged = 0;

    // 1) Joined members who haven't responded → reminder into the engagement.
    const memberEmails = await getNonResponderEmails(admin, engagementId, eng.group_id);
    if (memberEmails.length) {
      const m = reminderEmail({
        groupName: group?.name ?? "your group",
        title: engTitle,
        url: engUrl,
        responded: count ?? 0,
        total: eng.total_expected ?? 0,
        note,
      });
      for (let i = 0; i < memberEmails.length; i += 100) {
        await sendCampfireBatch(
          memberEmails.slice(i, i + 100).map((to) => ({
            from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults(),
          }))
        );
      }
      nudged += memberEmails.length;
    }

    // 2) Invited people who haven't joined yet (this card's guests + whole-group
    //    invites), minus any surprise-excluded address → an invite into this card.
    const excludedLc = new Set(
      ((eng.excluded_emails as string[]) ?? []).map((e) => e.toLowerCase())
    );
    const { data: pend } = await admin
      .from("campfire_invitations")
      .select("id, email, name, nudge_count")
      .eq("group_id", eng.group_id)
      .eq("status", "pending")
      .or(`engagement_id.is.null,engagement_id.eq.${engagementId}`);
    const invitees = (pend ?? []).filter(
      (p) => !excludedLc.has((p.email as string).toLowerCase())
    );
    if (invitees.length && group) {
      const meta = ENGAGEMENT_TYPES[eng.type as keyof typeof ENGAGEMENT_TYPES];
      const shared = {
        creator: group.name,
        groupName: group.name,
        title: engTitle,
        typeLabel: meta?.label || "engagement",
        typeIcon: meta?.icon || "🔥",
        isBlind: !!eng.is_blind,
        reveal: eng.reveal as string,
        deadline: eng.deadline as string | null,
        holdUntilDeadline: !!eng.hold_until_deadline,
      };
      const msgs = invitees.map((p) => {
        const joinUrl = eng.share_code
          ? `${base}/c/${eng.share_code}?inv=${encodeURIComponent(p.email as string)}`
          : `${buildJoinUrl(base, group.invite_code)}?inv=${encodeURIComponent(
              p.email as string
            )}&e=${engagementId}`;
        const im = newEngagementEmail({
          ...shared,
          url: joinUrl,
          invited: true,
          recipientName: (p.name as string) || undefined,
          note,
        });
        return { from, to: [p.email as string], subject: im.subject, text: im.text, html: im.html, ...mailDefaults() };
      });
      for (let i = 0; i < msgs.length; i += 100) {
        await sendCampfireBatch(msgs.slice(i, i + 100));
      }
      const nowIso = new Date().toISOString();
      for (const p of invitees) {
        await admin
          .from("campfire_invitations")
          .update({ last_nudged_at: nowIso, last_emailed_at: nowIso, nudge_count: ((p.nudge_count as number) ?? 0) + 1 })
          .eq("id", p.id);
      }
      nudged += invitees.length;
    }

    // Stamp the digest time so repeat clicks (and the cron) hold off for ~20h.
    await admin
      .from("engagements")
      .update({ deadline_nudged_at: new Date().toISOString() })
      .eq("id", engagementId);

    return NextResponse.json({ ok: true, nudged });
  } catch (err) {
    console.error("Campfire engagement nudge error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
