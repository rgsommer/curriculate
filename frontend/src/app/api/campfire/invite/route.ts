import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  authorizeGroupRequester,
  buildJoinUrl,
  inviteEmail,
  mailDefaults,
  EMAIL_RE,
  MAX_INVITES,
} from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const rawEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const originIn = typeof body?.origin === "string" ? body.origin : "";

    if (!groupId) {
      return NextResponse.json({ error: "Missing group." }, { status: 400 });
    }

    const auth = await authorizeGroupRequester(req, groupId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin, requesterId } = auth;

    // Normalize, validate, dedupe, cap.
    let emails = Array.from(
      new Set(
        rawEmails
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => EMAIL_RE.test(e))
      )
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

    // Don't re-email people who already joined.
    const { data: existing } = await admin
      .from("campfire_invitations")
      .select("email, status")
      .eq("group_id", groupId)
      .in("email", emails);
    const alreadyJoined = new Set(
      (existing ?? []).filter((r) => r.status === "joined").map((r) => r.email)
    );
    emails = emails.filter((e) => !alreadyJoined.has(e));
    if (emails.length === 0) {
      return NextResponse.json(
        { error: "Those people have already joined." },
        { status: 400 }
      );
    }

    const baseJoinUrl = buildJoinUrl(originIn, group.invite_code);
    const from = process.env.CONTACT_FROM || "Campfire <noreply@curriculate.net>";

    // Per-recipient link carrying the invited address (?inv=…) so we can mark the
    // right invitation joined even if they sign in with a different email.
    const { error: sendErr } = await resend.batch.send(
      emails.map((to) => {
        const joinUrl = `${baseJoinUrl}?inv=${encodeURIComponent(to)}`;
        const m = inviteEmail({
          inviter,
          groupName: group.name,
          groupEmoji: group.avatar_emoji,
          inviteCode: group.invite_code,
          joinUrl,
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

    // Persist the invitations (so they can be tracked, nudged, revoked).
    await admin.from("campfire_invitations").upsert(
      emails.map((email) => ({
        group_id: groupId,
        email,
        invited_by: requesterId,
        status: "pending",
        last_nudged_at: null,
      })),
      { onConflict: "group_id,email" }
    );

    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (err) {
    console.error("Campfire invite route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
