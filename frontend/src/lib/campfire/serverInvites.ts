import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { firstName } from "./parseInvites";

export const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;
export const MAX_INVITES = 50;

// Pull a clean address out of a raw entry that may be "Name <email@x.com>".
export function extractEmail(raw: unknown): string {
  const m = String(raw).match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/);
  return m ? m[0].trim().toLowerCase() : "";
}

// Campfire-branded sender (overrides the shared CONTACT_FROM so the name reads
// "Campfire"). noreply@curriculate.net is on the DKIM-verified domain.
export function campfireFrom() {
  return process.env.CAMPFIRE_FROM || "Campfire <noreply@curriculate.net>";
}

// Deliverability defaults applied to every Campfire email: a real Reply-To (not
// the noreply sender) and a List-Unsubscribe header — both signal legitimacy to
// spam filters (Gmail/Yahoo look for List-Unsubscribe on notification mail).
export function mailDefaults() {
  const addr = process.env.CONTACT_REPLYTO || "admin@curriculate.net";
  return {
    replyTo: addr,
    headers: {
      "List-Unsubscribe": `<mailto:${addr}?subject=unsubscribe%20campfire>`,
    },
  };
}

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
  | { admin: SupabaseClient; requesterId: string; role: string };

// Verify the caller's Supabase token and that they belong to the group.
// On failure returns `{ error, status }`; on success `{ admin, requesterId, role }`.
// Pass { requireAdmin: true } for host-only actions (managing invites, etc.).
// Routes narrow with: if ("error" in auth) return NextResponse.json(...).
export async function authorizeGroupRequester(
  req: Request,
  groupId: string,
  opts?: { requireAdmin?: boolean }
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
  if (opts?.requireAdmin && membership.role !== "admin") {
    return { error: "Only the group host can do that.", status: 403 };
  }
  return { admin, requesterId: requester.id, role: membership.role };
}

// Build the join link only from a verified curriculate origin (no injected links).
export function buildJoinUrl(originIn: string, inviteCode: string) {
  const base = /^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
    ? originIn
    : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
  return `${base.replace(/\/$/, "")}/campfirelive/join/${inviteCode}`;
}

// Emails of group members who haven't responded to this engagement yet.
// Member emails live in auth.users (not profiles), so we resolve via admin auth.
export async function getNonResponderEmails(
  admin: SupabaseClient,
  engagementId: string,
  groupId: string
): Promise<string[]> {
  const [{ data: members }, { data: responses }] = await Promise.all([
    admin.from("group_members").select("user_id").eq("group_id", groupId),
    admin.from("responses").select("user_id").eq("engagement_id", engagementId),
  ]);
  const responded = new Set((responses ?? []).map((r) => r.user_id as string));
  const missing = (members ?? [])
    .map((m) => m.user_id as string)
    .filter((id) => !responded.has(id));
  const emails: string[] = [];
  for (const id of missing) {
    const { data } = await admin.auth.admin.getUserById(id);
    const email = data?.user?.email;
    if (email) emails.push(email);
  }
  return emails;
}

// Emails of every member of a group.
export async function getGroupMemberEmails(
  admin: SupabaseClient,
  groupId: string
): Promise<string[]> {
  const { data: members } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  const emails: string[] = [];
  for (const m of members ?? []) {
    const { data } = await admin.auth.admin.getUserById(m.user_id as string);
    const email = data?.user?.email;
    if (email) emails.push(email);
  }
  return emails;
}

export function revealEmail(opts: { groupName: string; title: string; url: string }) {
  const { groupName, title, url } = opts;
  const subject = `Results are in: "${title}" (${groupName})`;
  const text = `Everyone's responded — the results for "${title}" in ${groupName} just unlocked!

See the reveal: ${url}`;
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">🎉</div>
  <h1 style="font-size:22px; margin:8px 0;">Results are in!</h1>
  <p style="color:#475569; margin:0 0 12px;">Everyone's responded — the reveal for <strong>"${escapeHtml(title)}"</strong> in <strong>${escapeHtml(groupName)}</strong> just unlocked.</p>
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">See the reveal</a>
  </p>
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();
  return { subject, text, html };
}

// Sent when a new engagement is posted (if the creator opted into emailing the
// group). Describes what makes THIS engagement fun, in plain, inviting language.
export function newEngagementEmail(opts: {
  creator: string;
  groupName: string;
  title: string;
  typeLabel: string;
  typeIcon: string;
  isBlind: boolean;
  reveal: string;
  deadline: string | null;
  holdUntilDeadline?: boolean; // reveals ON the date (e.g. a birthday), not when all answer
  url: string;
  invited?: boolean; // recipient isn't a member yet — frame it as an invite
  cardGuest?: boolean; // invited to ONLY this engagement (a guest, not the group)
  recipientName?: string; // greet them by name if we have it
}) {
  const { creator, groupName, title, typeLabel, typeIcon, isBlind, reveal, deadline, holdUntilDeadline, url, invited, cardGuest, recipientName } = opts;
  const hi = firstName(recipientName);
  const subject = cardGuest
    ? `${creator} invited you to a ${typeLabel} on Campfire`
    : invited
    ? `${creator} invited you to "${groupName}" on Campfire`
    : `${creator} started a ${typeLabel} in ${groupName}`;
  const intro =
    (hi ? `Hi ${hi}, ` : "") +
    (cardGuest
      ? `${creator} invited you to add to a ${typeLabel} on Campfire — just this one, no account or group to join:`
      : invited
      ? `${creator} invited you to join "${groupName}" on Campfire — and there's already a ${typeLabel} waiting for you:`
      : `${creator} started a ${typeLabel} in ${groupName}:`);
  const cta = cardGuest ? "Add your answer" : invited ? "Join & add your answer" : "Add your answer";

  const bits: string[] = [];
  // "Hold until the date" (birthdays, baby reveals) opens ON the day regardless of
  // who's answered — so don't claim it unlocks "once everyone has answered".
  if (holdUntilDeadline && deadline) {
    const dayStr = new Date(deadline).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    bits.push(
      `🎁 It stays sealed and opens on ${dayStr} — a surprise on the day. Add yours before then!`
    );
  } else if (reveal === "as_they_come" || reveal === "instant") {
    bits.push("⚡ Answers show up live as they land — no waiting.");
  } else if (reveal === "all_at_once") {
    bits.push("🎬 Everyone answers in secret, then the host reveals it all at once.");
  } else {
    bits.push("🔒 It's sealed — no peeking. The results unlock the instant everyone has answered.");
  }
  if (isBlind) {
    bits.push(
      "🙈 And it's anonymous — nobody sees whose answer is whose. Half the fun is trying to guess who wrote what once it's revealed!"
    );
  }
  // Skip the generic "answer by" line when we've already given the open date above.
  if (deadline && !holdUntilDeadline) {
    bits.push(`⏰ Get your answer in by ${new Date(deadline).toLocaleString()}.`);
  }

  const text = `${intro}

"${title}"

${bits.map((b) => "• " + b).join("\n")}

${cta}: ${url}`;

  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${typeIcon}</div>
  <p style="color:#475569; margin:0 0 4px;">${escapeHtml(intro)}</p>
  <h1 style="font-size:22px; margin:4px 0 14px;">${escapeHtml(title)}</h1>
  <ul style="color:#475569; margin:0 0 16px; padding-left:18px;">
    ${bits.map((b) => `<li style="margin-bottom:6px;">${escapeHtml(b)}</li>`).join("")}
  </ul>
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">${escapeHtml(cta)}</a>
  </p>
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();

  return { subject, text, html };
}

// Sent to the HOST when a scheduled engagement auto-opens (e.g. next year's
// birthday card re-opening on its own). Frames it as "yours just went live — sign
// it and make sure everyone's invited", since the host didn't do anything today.
export function cardLiveEmail(opts: {
  groupName: string;
  title: string;
  typeLabel: string;
  typeIcon: string;
  deadline: string | null;
  url: string;
}) {
  const { groupName, title, typeLabel, typeIcon, deadline, url } = opts;
  const subject = `Your ${typeLabel} just opened: "${title}"`;
  const when = deadline
    ? ` It reveals on ${new Date(deadline).toLocaleDateString()}, so there's time to round everyone up.`
    : "";
  const intro = `Heads up — the ${typeLabel} you set up in ${groupName} just opened automatically. Add yours and make sure everyone's invited before the big day.${when}`;
  const text = `${intro}

"${title}"

Open it: ${url}`;
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${typeIcon}</div>
  <h1 style="font-size:20px; margin:8px 0;">Your ${escapeHtml(typeLabel)} just opened</h1>
  <p style="color:#475569; margin:0 0 6px;">${escapeHtml(intro)}</p>
  <h2 style="font-size:18px; margin:8px 0 14px;">"${escapeHtml(title)}"</h2>
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">Open it</a>
  </p>
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();
  return { subject, text, html };
}

export function reminderEmail(opts: {
  groupName: string;
  title: string;
  url: string;
  responded: number;
  total: number;
}) {
  const { groupName, title, url, responded, total } = opts;
  const subject = `Your response is needed: "${title}" (${groupName})`;
  const text = `The group "${groupName}" is waiting on you for "${title}".
${responded} of ${total} have responded — be one of the ones that unlocks the reveal!

Respond here: ${url}`;
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">⏰</div>
  <h1 style="font-size:20px; margin:8px 0;">Your response is needed</h1>
  <p style="color:#475569; margin:0 0 12px;">The group <strong>${escapeHtml(groupName)}</strong> is waiting on you for <strong>"${escapeHtml(title)}"</strong>. ${responded} of ${total} have responded — nobody sees the results until everyone's in.</p>
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">Respond now</a>
  </p>
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();
  return { subject, text, html };
}

export function inviteEmail(opts: {
  inviter: string;
  groupName: string;
  groupEmoji: string;
  inviteCode: string;
  joinUrl: string;
  nudge?: boolean;
  recipientName?: string; // greet them by name if we have it
}) {
  const { inviter, groupName, groupEmoji, inviteCode, joinUrl, nudge, recipientName } = opts;
  const hi = firstName(recipientName);
  const subject = nudge
    ? `Reminder: ${inviter} invited you to "${groupName}" on Campfire`
    : `${inviter} invited you to "${groupName}" on Campfire`;

  const lead =
    (hi ? `Hi ${hi}, ` : "") +
    (nudge
      ? `${inviter} is still hoping you'll join "${groupName}" on Campfire. The group's waiting on you!`
      : `${inviter} invited you to join "${groupName}" on Campfire.`);

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
