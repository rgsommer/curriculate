import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  authorizeGroupRequester,
  buildJoinUrl,
  inviteEmail,
  mailDefaults,
} from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

// Re-send the invite (as a friendly reminder) to people who haven't joined.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const originIn = typeof body?.origin === "string" ? body.origin : "";
    // Optional: specific emails. Omit to nudge everyone still pending.
    const only: string[] | null = Array.isArray(body?.emails)
      ? body.emails.map((e: unknown) => String(e).trim().toLowerCase())
      : null;

    if (!groupId) {
      return NextResponse.json({ error: "Missing group." }, { status: 400 });
    }

    const auth = await authorizeGroupRequester(req, groupId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin, requesterId } = auth;

    let q = admin
      .from("campfire_invitations")
      .select("id, email, nudge_count")
      .eq("group_id", groupId)
      .eq("status", "pending");
    if (only && only.length) q = q.in("email", only);
    const { data: pending } = await q;

    if (!pending || pending.length === 0) {
      return NextResponse.json({ ok: true, nudged: 0 });
    }

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

    const joinUrl = buildJoinUrl(originIn, group.invite_code);
    const { subject, text, html } = inviteEmail({
      inviter,
      groupName: group.name,
      groupEmoji: group.avatar_emoji,
      inviteCode: group.invite_code,
      joinUrl,
      nudge: true,
    });
    const from = process.env.CONTACT_FROM || "Campfire <noreply@curriculate.net>";

    const { error: sendErr } = await resend.batch.send(
      pending.map((p) => ({ from, to: [p.email], subject, text, html, ...mailDefaults() }))
    );
    if (sendErr) {
      console.error("Campfire nudge send error:", sendErr);
      return NextResponse.json(
        { error: "Couldn't send the nudges. Try again." },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    await Promise.all(
      pending.map((p) =>
        admin
          .from("campfire_invitations")
          .update({ last_nudged_at: now, nudge_count: (p.nudge_count ?? 0) + 1 })
          .eq("id", p.id)
      )
    );

    return NextResponse.json({ ok: true, nudged: pending.length });
  } catch (err) {
    console.error("Campfire nudge route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
