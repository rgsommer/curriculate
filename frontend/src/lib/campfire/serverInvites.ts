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
  // Recognizable sender: the "(Curriculate)" ties the unfamiliar "Campfire" brand
  // to the curriculate.net domain recipients see, which helps inbox placement.
  return process.env.CAMPFIRE_FROM || "Campfire (Curriculate) <noreply@curriculate.net>";
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

// The public Campfire app URL. Deliberately NOT NEXT_PUBLIC_SITE_URL — in this
// project that's pointed at the API/backend host (api.curriculate.net), which
// yields dead links ("Cannot GET /campfirelive/..."). CAMPFIRE_PUBLIC_URL (a
// runtime var) can override; otherwise the canonical site.
export function campfireSiteUrl(): string {
  return (
    process.env.CAMPFIRE_PUBLIC_URL || "https://www.curriculate.net"
  ).replace(/\/$/, "");
}

// Build the join link only from a verified curriculate origin (no injected links).
export function buildJoinUrl(originIn: string, inviteCode: string) {
  const base = /^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
    ? originIn
    : campfireSiteUrl();
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

// Resolve a card's recipient(s) from the excluded surprise user ids: a display
// label ("Mom" / "Mom & Dad") plus the set of their lowercased emails.
export async function getCardRecipients(
  admin: SupabaseClient,
  groupId: string,
  excludedUserIds: string[],
  // Used only when no recipient name resolves. Celebration cards (Retirement, etc.)
  // pass a non-birthday fallback so the copy never says "birthday".
  fallback = "The birthday person"
): Promise<{ label: string; emails: Set<string> }> {
  const emails = new Set<string>();
  const names: string[] = [];
  for (const uid of excludedUserIds ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(uid);
    const em = u?.user?.email?.toLowerCase();
    if (em) emails.add(em);
    const { data: gm } = await admin
      .from("group_members")
      .select("display_name")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    let name = (gm?.display_name as string | null) ?? null;
    if (!name) {
      const { data: p } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", uid)
        .maybeSingle();
      name = (p?.display_name as string | null) ?? null;
    }
    if (name) names.push(name);
  }
  return { label: names.join(" & ") || fallback, emails };
}

// Birthday card just opened. The wishes are private to the recipient, but everyone
// who signed gets told the card was delivered + how many wishes went in.
export function cardRevealEmail(opts: {
  groupName: string;
  title: string;
  recipientName: string;
  count: number;
  url: string;
  forRecipient: boolean;
  icon?: string; // 🎂 for a birthday; 💐/👔/🎉 for other celebration cards
}) {
  const { groupName, title, recipientName, count, url, forRecipient, icon = "🎂" } = opts;
  const wishes = `${count} ${count === 1 ? "wish" : "wishes"}`;
  const subject = forRecipient
    ? `${icon} Your card is here — ${wishes} inside!`
    : `💌 ${recipientName} just got the card (${wishes})`;
  const headline = forRecipient ? `Your card is here! ${icon}` : `${recipientName} got the card! 💌`;
  const lead = forRecipient
    ? `Open "${escapeHtml(title)}" in ${escapeHtml(groupName)} — ${wishes} written just for you.`
    : `"${escapeHtml(title)}" just opened in ${escapeHtml(groupName)}. <strong>${escapeHtml(
        recipientName
      )}</strong> received the card with <strong>${wishes}</strong> — each message is private to them.`;
  const cta = forRecipient ? "Open my card" : "See the card";
  const text = forRecipient
    ? `Your card is here! Open "${title}" in ${groupName} — ${wishes} written just for you.\n\n${cta}: ${url}`
    : `"${title}" just opened in ${groupName}. ${recipientName} received the card with ${wishes} — each message is private to them.\n\n${cta}: ${url}`;
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${icon}</div>
  <h1 style="font-size:22px; margin:8px 0;">${escapeHtml(headline)}</h1>
  <p style="color:#475569; margin:0 0 12px;">${lead}</p>
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">${cta}</a>
  </p>
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();
  return { subject, text, html };
}

// The card recipient sent a thank-you to everyone who signed.
export function cardThanksEmail(opts: {
  recipientName: string;
  groupName: string;
  message?: string | null;
  url: string;
  icon?: string;
}) {
  const { recipientName, groupName, message, url, icon = "💛" } = opts;
  const subject = `${icon} ${recipientName} says thank you!`;
  const note = message && message.trim() ? message.trim() : null;
  const lead = `${escapeHtml(
    recipientName
  )} loved the card the group signed in ${escapeHtml(groupName)} and wanted to say thanks.`;
  const text =
    `${recipientName} loved the card from ${groupName} and says thank you!` +
    (note ? `\n\n"${note}"` : "") +
    `\n\nSee the card: ${url}`;
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${icon}</div>
  <h1 style="font-size:22px; margin:8px 0;">${escapeHtml(recipientName)} says thank you!</h1>
  <p style="color:#475569; margin:0 0 12px;">${lead}</p>
  ${
    note
      ? `<div style="background:#fef2f2; border:1px solid #fecdd3; border-radius:12px; padding:14px; color:#9f1239; font-size:15px; margin:0 0 12px;">${escapeHtml(
          note
        )}</div>`
      : ""
  }
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();
  return { subject, text, html };
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

// Emails render server-side (UTC), so format reveal times in the app's timezone
// (default Eastern; override with CAMPFIRE_TZ) and show the zone so it's unambiguous.
const APP_TZ = process.env.CAMPFIRE_TZ || "America/Toronto";
function formatRevealWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: APP_TZ,
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TZ,
    timeZoneName: "short",
  });
  return `${day} at ${time}`;
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
    bits.push(
      `🎁 It stays sealed and opens on ${formatRevealWhen(
        deadline
      )} — a surprise on the day. Add yours before then!`
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
  // Hours until the reveal; when ~24h or less this becomes a "final call".
  hoursLeft?: number;
}) {
  const { groupName, title, url, responded, total, hoursLeft } = opts;
  const finalCall = typeof hoursLeft === "number" && hoursLeft <= 24;
  const closes =
    typeof hoursLeft === "number"
      ? hoursLeft <= 1
        ? "within the hour"
        : `in about ${hoursLeft} hours`
      : "";
  const subject = finalCall
    ? `⏰ Final call: "${title}" closes ${closes} (${groupName})`
    : `Your response is needed: "${title}" (${groupName})`;
  const heading = finalCall ? "Final call — last chance to respond" : "Your response is needed";
  const text = `${
    finalCall
      ? `⏰ Final call — "${title}" in "${groupName}" closes ${closes}.`
      : `The group "${groupName}" is waiting on you for "${title}".`
  }
${responded} of ${total} have responded — be one of the ones that unlocks the reveal!

Respond here: ${url}`;
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">⏰</div>
  <h1 style="font-size:20px; margin:8px 0;">${heading}</h1>
  <p style="color:#475569; margin:0 0 12px;">${
    finalCall
      ? `<strong>"${escapeHtml(title)}"</strong> in <strong>${escapeHtml(groupName)}</strong> closes <strong>${closes}</strong>.`
      : `The group <strong>${escapeHtml(groupName)}</strong> is waiting on you for <strong>"${escapeHtml(title)}"</strong>.`
  } ${responded} of ${total} have responded — nobody sees the results until everyone's in.</p>
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">Respond now</a>
  </p>
  <p style="margin:0;"><a href="${url}" style="color:#ea580c; word-break:break-all;">${url}</a></p>
</div>`.trim();
  return { subject, text, html };
}

// Daily recap of activity across a person's groups (counts/titles/names only —
// never the response content, so nothing sealed leaks). Members get the responses
// section; the host's groups also carry new members + new activities.
export function activityDigestEmail(opts: {
  recipientName?: string | null;
  url: string;
  groups: {
    name: string;
    emoji: string;
    responses: { title: string; icon: string; count: number }[];
    newMembers: string[];
    newEngagements: { title: string; icon: string }[];
  }[];
}) {
  const { recipientName, url, groups } = opts;
  const hi = firstName(recipientName ?? undefined);
  const events = groups.reduce(
    (a, g) =>
      a +
      g.responses.reduce((b, r) => b + r.count, 0) +
      g.newMembers.length +
      g.newEngagements.length,
    0
  );
  const subject = `🔥 ${events} new thing${events === 1 ? "" : "s"} in your Campfire group${
    groups.length === 1 ? "" : "s"
  }`;

  const groupText = (g: (typeof groups)[number]) => {
    const lines: string[] = [`${g.emoji} ${g.name}`];
    g.responses.forEach((r) =>
      lines.push(`  • ${r.title} — ${r.count} new response${r.count === 1 ? "" : "s"}`)
    );
    g.newEngagements.forEach((e) => lines.push(`  • New: ${e.title}`));
    if (g.newMembers.length)
      lines.push(`  • Joined: ${g.newMembers.join(", ")}`);
    return lines.join("\n");
  };
  const text = `${hi ? hi + ",\n\n" : ""}Here's what happened in your Campfire groups today:

${groups.map(groupText).join("\n\n")}

See it all: ${url}`;

  const groupHtml = (g: (typeof groups)[number]) => {
    const rows: string[] = [];
    g.responses.forEach((r) =>
      rows.push(
        `<div style="color:#475569; font-size:14px; margin:0 0 3px;">${r.icon} ${escapeHtml(
          r.title
        )} — <strong>${r.count}</strong> new response${r.count === 1 ? "" : "s"}</div>`
      )
    );
    g.newEngagements.forEach((e) =>
      rows.push(
        `<div style="color:#475569; font-size:14px; margin:0 0 3px;">✨ New: ${e.icon} ${escapeHtml(
          e.title
        )}</div>`
      )
    );
    if (g.newMembers.length)
      rows.push(
        `<div style="color:#475569; font-size:14px; margin:0 0 3px;">👋 Joined: ${escapeHtml(
          g.newMembers.join(", ")
        )}</div>`
      );
    return `
    <div style="margin:0 0 16px;">
      <div style="font-weight:700; font-size:15px; margin:0 0 6px;">${g.emoji} ${escapeHtml(
        g.name
      )}</div>
      ${rows.join("")}
    </div>`;
  };
  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:480px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">🔥</div>
  <h1 style="font-size:20px; margin:8px 0;">New activity in your groups</h1>
  ${hi ? `<p style="color:#475569; margin:0 0 12px;">Hi ${escapeHtml(hi)}, here's today's recap:</p>` : ""}
  ${groups.map(groupHtml).join("")}
  <p style="text-align:center; margin:24px 0;">
    <a href="${url}" style="background:linear-gradient(to right,#f97316,#f43f5e); color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:700; display:inline-block;">Open Campfire</a>
  </p>
  <p style="color:#94a3b8; font-size:12px; margin:0;">You can turn these digests off in the group's settings.</p>
</div>`.trim();
  return { subject, text, html };
}

// Seasonal nudge to a referral partner with a ready-to-post message + their link.
export function referralPromoEmail(opts: {
  name?: string | null;
  link: string;
  campaign: "school" | "xmas";
}) {
  const { name, link, campaign } = opts;
  const hi = firstName(name ?? undefined);
  const school = campaign === "school";
  const subject = school
    ? "🎁 Teacher gift season is coming — your Campfire link inside"
    : "🎄 Christmas card season — your Campfire link inside";

  // The blurb is written for THEM to copy-paste into a class/parent/team chat.
  const post = school
    ? `🎁 End of the school year is almost here! Let's get the class together for a teacher thank-you card on Campfire — everyone signs the card AND can chip in for a group gift card that's emailed automatically. No app, no accounts — just your name. Start here: ${link}`
    : `🎄 Christmas card time! Let's all sign one card for [name] on Campfire and chip in together for a group gift — it's sent automatically when the card opens. No app or account needed. Add yours here: ${link}`;

  const intro = `${hi ? hi + ",\n\n" : ""}${
    school
      ? "It's almost teacher-gift season — the perfect time to share Campfire with your school and parent groups."
      : "Christmas is around the corner — a great time to share Campfire for group cards and gifts."
  } Copy the message below into a class WhatsApp/Facebook group, team chat, or email — your referral link is built in.`;

  // The referrer's personal incentive — kept OUT of the paste-ready blurb (which
  // goes to their group). Roughly 1% of each contribution, added on top so it
  // costs the groups nothing.
  const earnings =
    "💸 And there's something in it for you: you earn about 1% of every group gift your linked groups chip in for — it's added on top, so it costs your groups nothing extra. Track your earnings any time on your Campfire referral dashboard.";

  const text = `${intro}

— — — — — — — — — —
${post}
— — — — — — — — — —

${earnings}

Your link: ${link}`;

  const html = `
<div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; max-width:520px; margin:0 auto; line-height:1.6; color:#0f172a;">
  <div style="font-size:40px;">${school ? "🎁" : "🎄"}</div>
  <h1 style="font-size:20px; margin:8px 0;">Time to share Campfire</h1>
  <p style="color:#475569; margin:0 0 12px;">${escapeHtml(intro)}</p>
  <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:14px; color:#7c2d12; font-size:14px;">
    ${escapeHtml(post)}
  </div>
  <p style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:12px; padding:12px 14px; color:#065f46; font-size:13px; margin:14px 0 0;">${escapeHtml(
    earnings
  )}</p>
  <p style="margin:16px 0 0;"><a href="${link}" style="color:#ea580c; font-weight:700; word-break:break-all;">${link}</a></p>
  <p style="color:#94a3b8; font-size:12px; margin:14px 0 0;">You're getting this because you're a Campfire referral partner.</p>
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
