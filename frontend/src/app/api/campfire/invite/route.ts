import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  authorizeGroupRequester,
  buildJoinUrl,
  inviteEmail,
  newEngagementEmail,
  mailDefaults,
  campfireFrom,
  getGroupMemberEmails,
  EMAIL_RE,
  MAX_INVITES,
  extractEmail,
} from "@/lib/campfire/serverInvites";
import { ENGAGEMENT_TYPES } from "@/lib/campfire/types";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    // Accept either a structured [{name, email}] list (preferred) or a bare
    // [email] list (legacy). Build an email->name map either way.
    const rawInvites: unknown[] = Array.isArray(body?.invites) ? body.invites : [];
    const rawEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const originIn = typeof body?.origin === "string" ? body.origin : "";
    // Stage = add to the group's invite list now, but DON'T email yet. They get
    // emailed when an engagement is posted (the engagement email is their invite).
    const stage = body?.stage === true;

    if (!groupId) {
      return NextResponse.json({ error: "Missing group." }, { status: 400 });
    }

    const auth = await authorizeGroupRequester(req, groupId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin, requesterId } = auth;

    // Normalize, validate, dedupe, cap — and remember each address's name.
    const nameByEmail = new Map<string, string>();
    const collected: string[] = [];
    for (const it of rawInvites) {
      const rec = it as { email?: unknown; name?: unknown };
      const email = extractEmail(rec?.email ?? it);
      if (!email) continue;
      collected.push(email);
      const nm = typeof rec?.name === "string" ? rec.name.trim() : "";
      if (nm && !nameByEmail.get(email)) nameByEmail.set(email, nm);
    }
    for (const e of rawEmails) {
      const email = extractEmail(e); // tolerates "Name <email@x.com>"
      if (email) collected.push(email);
    }
    let emails = Array.from(
      new Set(collected.filter((e) => EMAIL_RE.test(e)))
    ).slice(0, MAX_INVITES);

    if (emails.length === 0) {
      return NextResponse.json({ error: "No valid email addresses." }, { status: 400 });
    }

    // Group + inviter details.
    const { data: group } = await admin
      .from("groups")
      .select("name, invite_code, avatar_emoji")
      .eq("id", groupId)
      .single();
    if (!group) {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", requesterId)
      .single();
    const inviter = profile?.display_name || "A friend";

    // Don't invite people who are already in the group (incl. inviting yourself).
    const memberEmails = new Set(
      (await getGroupMemberEmails(admin, groupId)).map((e) => e.toLowerCase())
    );
    const wereMembers = emails.filter((e) => memberEmails.has(e));
    emails = emails.filter((e) => !memberEmails.has(e));
    if (emails.length === 0) {
      return NextResponse.json(
        {
          error:
            wereMembers.length === 1
              ? "That person is already in the group."
              : "Those people are already in the group.",
        },
        { status: 400 }
      );
    }

    // Don't re-email people who already joined.
    const { data: existing } = await admin
      .from("campfire_invitations")
      .select("email, status")
      .eq("group_id", groupId)
      .in("email", emails);
    const alreadyJoined = new Set(
      (existing ?? []).filter((r) => r.status === "joined").map((r) => r.email)
    );
    // People already on the pending list shouldn't be re-emailed about a live
    // engagement — only the genuinely new additions should get the catch-up email.
    const alreadyPending = new Set(
      (existing ?? []).filter((r) => r.status === "pending").map((r) => r.email)
    );
    emails = emails.filter((e) => !alreadyJoined.has(e));
    if (emails.length === 0) {
      return NextResponse.json(
        { error: "Those people have already joined." },
        { status: 400 }
      );
    }

    const baseJoinUrl = buildJoinUrl(originIn, group.invite_code);
    const from = campfireFrom();

    if (!stage) {
      // Per-recipient link carrying the invited address (?inv=…) so we can mark
      // the right invitation joined even if they sign in with a different email.
      const { error: sendErr } = await resend.batch.send(
        emails.map((to) => {
          const joinUrl = `${baseJoinUrl}?inv=${encodeURIComponent(to)}`;
          const m = inviteEmail({
            inviter,
            groupName: group.name,
            groupEmoji: group.avatar_emoji,
            inviteCode: group.invite_code,
            joinUrl,
            recipientName: nameByEmail.get(to),
          });
          return { from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults() };
        })
      );
      if (sendErr) {
        console.error("Campfire invite send error:", sendErr);
        return NextResponse.json(
          { error: "Couldn't send the invites. Try again." },
          { status: 502 }
        );
      }
    }

    // Persist the invitations (so they can be tracked, nudged, revoked, and
    // emailed when an engagement is posted).
    await admin.from("campfire_invitations").upsert(
      emails.map((email) => ({
        group_id: groupId,
        email,
        name: nameByEmail.get(email) || null,
        invited_by: requesterId,
        status: "pending",
        last_nudged_at: null,
      })),
      { onConflict: "group_id,email" }
    );

    // Catch-up: if the group already has a live engagement, the newly-added
    // invitees shouldn't have to wait for the next one — email them about the
    // current one right now (this is their invite). Only the genuinely new
    // additions are emailed, so re-adding someone won't double-send.
    let emailedNow = 0;
    const newlyAdded = emails.filter((e) => !alreadyPending.has(e));
    if (newlyAdded.length) {
      const { data: activeEng } = await admin
        .from("engagements")
        .select("id, title, type, is_blind, reveal, deadline")
        .eq("group_id", groupId)
        .eq("status", "active")
        .not("launched_at", "is", null)
        .order("launched_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeEng) {
        const meta = ENGAGEMENT_TYPES[activeEng.type as keyof typeof ENGAGEMENT_TYPES];
        const shared = {
          creator: inviter,
          groupName: group.name,
          title: activeEng.title,
          typeLabel: meta?.label || "engagement",
          typeIcon: meta?.icon || "🔥",
          isBlind: !!activeEng.is_blind,
          reveal: activeEng.reveal as string,
          deadline: activeEng.deadline as string | null,
        };
        const msgs = newlyAdded.map((to) => {
          const joinUrl = `${baseJoinUrl}?inv=${encodeURIComponent(to)}`;
          const im = newEngagementEmail({
            ...shared,
            url: joinUrl,
            invited: true,
            recipientName: nameByEmail.get(to),
          });
          return { from, to: [to], subject: im.subject, text: im.text, html: im.html, ...mailDefaults() };
        });
        for (let i = 0; i < msgs.length; i += 100) {
          const { error: sendErr } = await resend.batch.send(msgs.slice(i, i + 100));
          if (sendErr) {
            console.error("Campfire catch-up invite send error:", sendErr);
            break;
          }
          emailedNow += msgs.slice(i, i + 100).length;
        }
      }
    }

    return stage
      ? NextResponse.json({ ok: true, staged: emails.length, emailedNow })
      : NextResponse.json({ ok: true, sent: emails.length, emailedNow });
  } catch (err) {
    console.error("Campfire invite route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
