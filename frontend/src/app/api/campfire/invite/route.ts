import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INVITES = 50;

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function POST(req: Request) {
  try {
    // ── Auth: requester must present their Supabase access token ──
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const rawEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const originIn = typeof body?.origin === "string" ? body.origin : "";

    if (!groupId) {
      return NextResponse.json({ error: "Missing group." }, { status: 400 });
    }

    // Normalize, validate, dedupe, cap.
    const emails = Array.from(
      new Set(
        rawEmails
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => EMAIL_RE.test(e))
      )
    ).slice(0, MAX_INVITES);

    if (emails.length === 0) {
      return NextResponse.json(
        { error: "No valid email addresses." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json(
        { error: "Server not configured." },
        { status: 500 }
      );
    }
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Authn: resolve the user from their token ──
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const requester = userData?.user;
    if (userErr || !requester) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    // ── Authz: requester must be a member of the group ──
    const { data: membership } = await admin
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", requester.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json(
        { error: "You're not a member of this group." },
        { status: 403 }
      );
    }

    // ── Group + inviter details ──
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
      .eq("id", requester.id)
      .single();
    const inviter = profile?.display_name || "A friend";

    // Build the join link from a validated curriculate origin (no open redirect
    // into the email), falling back to the configured site URL.
    const base = /^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
      ? originIn
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
    const joinUrl = `${base.replace(/\/$/, "")}/campfirelive/join/${group.invite_code}`;

    const from = process.env.CONTACT_FROM || "Campfire <noreply@curriculate.net>";
    const subject = `${inviter} invited you to "${group.name}" on Campfire`;

    const text = `${inviter} invited you to join "${group.name}" on Campfire.

Campfire is where your group plays together — polls, challenges, questions — with one twist: nobody sees anyone's answers until everyone has responded. Then it all unlocks at once.

Tap to join: ${joinUrl}

How to jump in:
1. Tap the link above
2. Choose "Continue with Google" (about 5 seconds)
3. You're in — answer the first question and wait for the reveal!

Invite code: ${group.invite_code}`;

    const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${escapeHtml(group.avatar_emoji || "🔥")}</div>
  <h1 style="font-size:22px; margin:8px 0;">You're invited to "${escapeHtml(group.name)}"</h1>
  <p style="color:#475569; margin:0 0 12px;"><strong>${escapeHtml(inviter)}</strong> wants you in their Campfire group.</p>
  <p style="color:#475569; margin:0 0 12px;">Campfire is where your group plays together — polls, challenges, questions — with one twist: <strong>nobody sees anyone's answers until everyone has responded.</strong> Then it all unlocks at once. 🎉</p>
  <p style="text-align:center; margin:28px 0;">
    <a href="${joinUrl}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">Join the group</a>
  </p>
  <p style="color:#64748b; font-size:14px; margin:0 0 4px;">Or paste this link into your browser:</p>
  <p style="margin:0 0 16px;"><a href="${joinUrl}" style="color:#ea580c; word-break:break-all;">${joinUrl}</a></p>
  <p style="color:#94a3b8; font-size:12px; margin:0;">Invite code: ${escapeHtml(group.invite_code)}</p>
</div>`.trim();

    // Personalized one-per-recipient send in a single batch call.
    const { error: sendErr } = await resend.batch.send(
      emails.map((to) => ({ from, to: [to], subject, text, html }))
    );
    if (sendErr) {
      console.error("Campfire invite send error:", sendErr);
      return NextResponse.json(
        { error: "Couldn't send the invites. Try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (err) {
    console.error("Campfire invite route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
