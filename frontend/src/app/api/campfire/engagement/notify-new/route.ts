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
import { ENGAGEMENT_TYPES } from "@/lib/campfire/types";

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
      .select("group_id, creator_id, title, type, is_blind, reveal, deadline")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }

    const auth = await authorizeGroupRequester(req, eng.group_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    // Members to notify (everyone but the creator).
    const allEmails = await getGroupMemberEmails(admin, eng.group_id);
    const { data: creatorUser } = await admin.auth.admin.getUserById(eng.creator_id);
    const creatorEmail = (creatorUser?.user?.email || "").toLowerCase();
    const emails = allEmails.filter((e) => e.toLowerCase() !== creatorEmail);

    const [{ data: group }, { data: profile }] = await Promise.all([
      admin.from("groups").select("name, invite_code").eq("id", eng.group_id).single(),
      admin.from("profiles").select("display_name").eq("id", eng.creator_id).single(),
    ]);

    const meta = ENGAGEMENT_TYPES[eng.type as keyof typeof ENGAGEMENT_TYPES];
    const base = (/^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
      ? originIn
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"
    ).replace(/\/$/, "");
    const engUrl = `${base}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;
    const from = campfireFrom();
    const shared = {
      creator: profile?.display_name || "Someone",
      groupName: group?.name || "your group",
      title: eng.title,
      typeLabel: meta?.label || "engagement",
      typeIcon: meta?.icon || "🔥",
      isBlind: !!eng.is_blind,
      reveal: eng.reveal as string,
      deadline: eng.deadline as string | null,
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
    const { data: pend } = await admin
      .from("campfire_invitations")
      .select("email, name")
      .eq("group_id", eng.group_id)
      .eq("status", "pending");
    if (pend?.length && group?.invite_code) {
      const invMsgs = pend.map((p) => {
        const joinUrl = `${base}/campfirelive/join/${group.invite_code}?inv=${encodeURIComponent(p.email)}`;
        const im = newEngagementEmail({ ...shared, url: joinUrl, invited: true, recipientName: p.name || undefined });
        return { from, to: [p.email], subject: im.subject, text: im.text, html: im.html, ...mailDefaults() };
      });
      for (let i = 0; i < invMsgs.length; i += 100) {
        await resend.batch.send(invMsgs.slice(i, i + 100));
      }
      invited = invMsgs.length;
    }

    return NextResponse.json({ ok: true, sent: emails.length, invited });
  } catch (err) {
    console.error("Campfire notify-new error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
