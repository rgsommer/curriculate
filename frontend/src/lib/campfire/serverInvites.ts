import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_INVITES = 50;

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type AuthResult =
  | { error: string; status: number }
  | { admin: SupabaseClient; requesterId: string };

// Verify the caller's Supabase token and that they belong to the group.
// On failure returns `{ error, status }`; on success `{ admin, requesterId }`.
// Routes narrow with: if ("error" in auth) return NextResponse.json(...).
export async function authorizeGroupRequester(
  req: Request,
  groupId: string
): Promise<AuthResult> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Not signed in.", status: 401 };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { error: "Server not configured.", status: 500 };

  const admin = createClient(url, key);
  const { data, error } = await admin.auth.getUser(token);
  const requester = data?.user;
  if (error || !requester) return { error: "Not signed in.", status: 401 };

  const { data: membership } = await admin
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", requester.id)
    .maybeSingle();
  if (!membership) {
    return { error: "You're not a member of this group.", status: 403 };
  }
  return { admin, requesterId: requester.id };
}

// Build the join link only from a verified curriculate origin (no injected links).
export function buildJoinUrl(originIn: string, inviteCode: string) {
  const base = /^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
    ? originIn
    : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
  return `${base.replace(/\/$/, "")}/campfirelive/join/${inviteCode}`;
}

export function inviteEmail(opts: {
  inviter: string;
  groupName: string;
  groupEmoji: string;
  inviteCode: string;
  joinUrl: string;
  nudge?: boolean;
}) {
  const { inviter, groupName, groupEmoji, inviteCode, joinUrl, nudge } = opts;
  const subject = nudge
    ? `Reminder: ${inviter} invited you to "${groupName}" on Campfire`
    : `${inviter} invited you to "${groupName}" on Campfire`;

  const lead = nudge
    ? `Just a friendly nudge — ${inviter} is still hoping you'll join "${groupName}" on Campfire. The group's waiting on you!`
    : `${inviter} invited you to join "${groupName}" on Campfire.`;

  const text = `${lead}

Campfire is where your group plays together — polls, challenges, questions — with one twist: nobody sees anyone's answers until everyone has responded. Then it all unlocks at once.

Tap to join: ${joinUrl}

How to jump in:
1. Tap the link above
2. Choose "Continue with Google" (about 5 seconds)
3. You're in — answer the first question and wait for the reveal!

Invite code: ${inviteCode}`;

  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${escapeHtml(groupEmoji || "🔥")}</div>
  <h1 style="font-size:22px; margin:8px 0;">${nudge ? "Still time to join" : "You're invited"} — "${escapeHtml(groupName)}"</h1>
  <p style="color:#475569; margin:0 0 12px;">${escapeHtml(lead)}</p>
  <p style="color:#475569; margin:0 0 12px;">Campfire is where your group plays together — polls, challenges, questions — with one twist: <strong>nobody sees anyone's answers until everyone has responded.</strong> Then it all unlocks at once. 🎉</p>
  <p style="text-align:center; margin:28px 0;">
    <a href="${joinUrl}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">Join the group</a>
  </p>
  <p style="color:#64748b; font-size:14px; margin:0 0 4px;">Or paste this link into your browser:</p>
  <p style="margin:0 0 16px;"><a href="${joinUrl}" style="color:#ea580c; word-break:break-all;">${joinUrl}</a></p>
  <p style="color:#94a3b8; font-size:12px; margin:0;">Invite code: ${escapeHtml(inviteCode)}</p>
</div>`.trim();

  return { subject, text, html };
}
