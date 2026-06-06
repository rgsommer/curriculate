import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  authorizeGroupRequester,
  newEngagementEmail,
  campfireFrom,
  mailDefaults,
  getGroupMemberEmails,
  extractEmail,
  EMAIL_RE,
  MAX_INVITES,
} from "@/lib/campfire/serverInvites";
import { ENGAGEMENT_TYPES } from "@/lib/campfire/types";

const resend = new Resend(process.env.RESEND_API_KEY);

// Email specific people about ONE engagement, with a join link that drops them
// straight into it (?inv=…&e=…). Also stages them on the group's invite list.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    const originIn = typeof body?.origin === "string" ? body.origin : "";
    const rawInvites: unknown[] = Array.isArray(body?.invites) ? body.invites : [];
    const rawEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
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
      .select("group_id, creator_id, title, type, is_blind, reveal, deadline, launched_at")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }

    const auth = await authorizeGroupRequester(req, eng.group_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin, requesterId, role } = auth;

    // Build the email list (+ optional names) from either shape.
    const nameByEmail = new Map<string, string>();
    const collected: string[] = [];
    for (const it of rawInvites) {
      const obj = it as { email?: unknown; name?: unknown };
      const email = extractEmail(obj?.email ?? it);
      if (!email) continue;
      collected.push(email);
      const nm = typeof obj?.name === "string" ? obj.name.trim() : "";
      if (nm && !nameByEmail.get(email)) nameByEmail.set(email, nm);
    }
    for (const e of rawEmails) {
      const email = extractEmail(e);
      if (email) collected.push(email);
    }
    let emails = Array.from(new Set(collected.filter((e) => EMAIL_RE.test(e)))).slice(
      0,
      MAX_INVITES
    );
    if (emails.length === 0) {
      return NextResponse.json({ error: "No valid email addresses." }, { status: 400 });
    }

    // Don't re-invite existing members.
    const memberEmails = new Set(
      (await getGroupMemberEmails(admin, eng.group_id)).map((e) => e.toLowerCase())
    );
    emails = emails.filter((e) => !memberEmails.has(e));
    if (emails.length === 0) {
      return NextResponse.json(
        { error: "Those people are already in the group." },
        { status: 400 }
      );
    }

    const [{ data: group }, { data: profile }, { data: gm }] = await Promise.all([
      admin
        .from("groups")
        .select("name, invite_code, allow_member_invites")
        .eq("id", eng.group_id)
        .single(),
      admin.from("profiles").select("display_name").eq("id", eng.creator_id).single(),
      admin
        .from("group_members")
        .select("display_name")
        .eq("group_id", eng.group_id)
        .eq("user_id", eng.creator_id)
        .maybeSingle(),
    ]);
    if (group && role !== "admin" && !group.allow_member_invites) {
      return NextResponse.json(
        { error: "Only the host can invite people to this group." },
        { status: 403 }
      );
    }
    if (!group) {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    const creatorName = gm?.display_name || profile?.display_name || "Someone";

    const meta = ENGAGEMENT_TYPES[eng.type as keyof typeof ENGAGEMENT_TYPES];
    const base = (/^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
      ? originIn
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"
    ).replace(/\/$/, "");
    const from = campfireFrom();
    const shared = {
      creator: creatorName,
      groupName: group.name,
      title: eng.title,
      typeLabel: meta?.label || "engagement",
      typeIcon: meta?.icon || "🔥",
      isBlind: !!eng.is_blind,
      reveal: eng.reveal as string,
      deadline: eng.deadline as string | null,
    };

    const msgs = emails.map((to) => {
      const joinUrl = `${base}/campfirelive/join/${group.invite_code}?inv=${encodeURIComponent(
        to
      )}&e=${engagementId}`;
      const m = newEngagementEmail({
        ...shared,
        url: joinUrl,
        invited: true,
        recipientName: nameByEmail.get(to),
      });
      return { from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults() };
    });
    for (let i = 0; i < msgs.length; i += 100) {
      const { error: sendErr } = await resend.batch.send(msgs.slice(i, i + 100));
      if (sendErr) {
        console.error("Campfire engagement-invite send error:", sendErr);
        return NextResponse.json({ error: "Couldn't send. Try again." }, { status: 502 });
      }
    }

    // Track them on the group's invite list.
    await admin.from("campfire_invitations").upsert(
      emails.map((email) => ({
        group_id: eng.group_id,
        email,
        name: nameByEmail.get(email) || null,
        invited_by: requesterId,
        status: "pending",
        last_nudged_at: null,
      })),
      { onConflict: "group_id,email" }
    );

    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (err) {
    console.error("Campfire engagement-invite route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
