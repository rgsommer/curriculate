import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  authorizeGroupRequester,
  getGroupMemberEmails,
  newEngagementEmail,
  campfireFrom,
  mailDefaults,
} from "@/lib/campfire/serverInvites";
import { ENGAGEMENT_TYPES, resolveTitle, engagementIcon } from "@/lib/campfire/types";

const resend = new Resend(process.env.RESEND_API_KEY);

// Emails the group when a new engagement is posted, describing its distinctives.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    const originIn = typeof body?.origin === "string" ? body.origin : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server not configured." }, { status: 500 });
    }
    const svc = createClient(url, serviceKey);
    const { data: eng } = await svc
      .from("engagements")
      .select("group_id, creator_id, title, type, config, is_blind, reveal, deadline, hold_until_deadline, scheduled_open_at, excluded_user_ids, excluded_emails, birth_year")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }

    // Don't notify the group about a card that isn't open to sign yet — a card
    // scheduled to open later gets its "it's open" email from the cron when its
    // open date actually arrives, not the moment it's created/launched.
    if (
      eng.scheduled_open_at &&
      new Date(eng.scheduled_open_at as string).getTime() > Date.now()
    ) {
      return NextResponse.json({ ok: true, sent: 0, invited: 0, deferred: true });
    }

    const auth = await authorizeGroupRequester(req, eng.group_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    // Surprise: never email the excluded members at launch (would spoil it).
    const excludedEmails = new Set<string>();
    for (const uid of (eng.excluded_user_ids as string[]) ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      const em = u?.user?.email?.toLowerCase();
      if (em) excludedEmails.add(em);
    }

    // Members to notify: everyone in the group EXCEPT the creator (you don't email
    // yourself) and any surprise recipients. De-duped by lowercased address.
    const allEmails = await getGroupMemberEmails(admin, eng.group_id);
    const { data: creatorUser } = await admin.auth.admin.getUserById(eng.creator_id);
    const creatorEmail = (creatorUser?.user?.email || "").toLowerCase();
    const recipients = new Set(
      allEmails
        .map((e) => e.toLowerCase())
        .filter((e) => e && e !== creatorEmail && !excludedEmails.has(e))
    );

    const [{ data: group }, { data: profile }, { data: gm }] = await Promise.all([
      admin.from("groups").select("name, invite_code, creator_id").eq("id", eng.group_id).single(),
      admin.from("profiles").select("display_name").eq("id", eng.creator_id).single(),
      admin
        .from("group_members")
        .select("display_name")
        .eq("group_id", eng.group_id)
        .eq("user_id", eng.creator_id)
        .maybeSingle(),
    ]);
    // Prefer the creator's per-group name (e.g. "Mr. Sommer") in this group.
    const creatorName = gm?.display_name || profile?.display_name || "Someone";

    // Guarantee the GROUP host is notified (unless they created this engagement),
    // even in the unlikely case their membership row is missing.
    if (group?.creator_id && group.creator_id !== eng.creator_id) {
      const { data: hostUser } = await admin.auth.admin.getUserById(group.creator_id);
      const hostEmail = (hostUser?.user?.email || "").toLowerCase();
      if (hostEmail && hostEmail !== creatorEmail) recipients.add(hostEmail);
    }
    const emails = Array.from(recipients);

    const meta = ENGAGEMENT_TYPES[eng.type as keyof typeof ENGAGEMENT_TYPES];
    const base = (/^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
      ? originIn
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"
    ).replace(/\/$/, "");
    const engUrl = `${base}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;
    const from = campfireFrom();
    const shared = {
      creator: creatorName,
      groupName: group?.name || "your group",
      title: resolveTitle(eng.title, eng.birth_year as number | null, eng.deadline as string | null),
      typeLabel: meta?.label || "engagement",
      typeIcon: engagementIcon({
        type: eng.type as string,
        config: eng.config as { occasion?: string } | null,
      }),
      isBlind: !!eng.is_blind,
      reveal: eng.reveal as string,
      deadline: eng.deadline as string | null,
      holdUntilDeadline: !!eng.hold_until_deadline,
    };

    // Members → notification that links straight to the engagement.
    if (emails.length) {
      const m = newEngagementEmail({ ...shared, url: engUrl });
      for (let i = 0; i < emails.length; i += 100) {
        await resend.batch.send(
          emails.slice(i, i + 100).map((to) => ({
            from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults(),
          }))
        );
      }
    }

    // Still-pending invitees → this engagement IS their invite (join link, ?inv=…).
    let invited = 0;
    const { data: pendRaw } = await admin
      .from("campfire_invitations")
      .select("email, name")
      .eq("group_id", eng.group_id)
      .eq("status", "pending");
    // Surprise: don't email excluded invitees either (would spoil it).
    const excludedLc = new Set(
      ((eng.excluded_emails as string[]) ?? []).map((e) => e.toLowerCase())
    );
    const pend = (pendRaw ?? []).filter((p) => !excludedLc.has(p.email.toLowerCase()));
    if (pend?.length && group?.invite_code) {
      const invMsgs = pend.map((p) => {
        const joinUrl = `${base}/campfirelive/join/${group.invite_code}?inv=${encodeURIComponent(p.email)}`;
        const im = newEngagementEmail({ ...shared, url: joinUrl, invited: true, recipientName: p.name || undefined });
        return { from, to: [p.email], subject: im.subject, text: im.text, html: im.html, ...mailDefaults() };
      });
      for (let i = 0; i < invMsgs.length; i += 100) {
        await resend.batch.send(invMsgs.slice(i, i + 100));
      }
      // Record that these invitees were emailed (the host can see who's been reached).
      await admin
        .from("campfire_invitations")
        .update({ last_emailed_at: new Date().toISOString() })
        .eq("group_id", eng.group_id)
        .in("email", pend.map((p) => p.email));
      invited = invMsgs.length;
    }

    return NextResponse.json({ ok: true, sent: emails.length, invited });
  } catch (err) {
    console.error("Campfire notify-new error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
