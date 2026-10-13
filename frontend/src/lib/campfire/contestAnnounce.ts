import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contestWinnerEmail,
  getGroupMemberEmails,
  mailDefaults,
  sendCampfireBatch,
} from "./serverInvites";
import { pushToUsers } from "./push";

// The winner's name for the announcement: their name in this group, else their
// profile name, else their account name. Never "The winner" when a name exists.
export async function contestWinnerName(
  admin: SupabaseClient,
  groupId: string,
  winnerUid: string
): Promise<string | undefined> {
  const { data: gm } = await admin
    .from("group_members")
    .select("display_name")
    .eq("group_id", groupId)
    .eq("user_id", winnerUid)
    .maybeSingle();
  if (gm?.display_name) return gm.display_name as string;
  const { data: p } = await admin.from("profiles").select("display_name").eq("id", winnerUid).maybeSingle();
  if (p?.display_name) return p.display_name as string;
  const { data: u } = await admin.auth.admin.getUserById(winnerUid);
  return (u?.user?.user_metadata?.name as string | undefined) || undefined;
}

// Celebrate the winner + tell everyone else (email + push). Used by the deadlines
// cron when a contest closes and by the host's "re-announce the winner" button.
export async function announceContestWinner(
  admin: SupabaseClient,
  opts: {
    base: string;
    from: string;
    e: { id: string; group_id: string; title: string };
    winnerUid: string;
    winnerEmail: string | null;
    winnerName: string | undefined;
    prize: "paid" | "pending" | "none";
    byScore: boolean;
    prizeText?: string | null;
  }
): Promise<{ sent: number }> {
  const { base, from, e, winnerUid, winnerEmail, winnerName, prize, byScore, prizeText = null } = opts;
  const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
  const { data: g } = await admin.from("groups").select("name").eq("id", e.group_id).single();
  const groupName = (g?.name as string) ?? "your group";
  const who = winnerName || "The winner";
  // The prize pot as actually paid in — said plainly in both emails and on the card.
  const [{ data: contribs }, { data: eg }] = await Promise.all([
    admin.from("campfire_gift_contributions").select("amount_cents").eq("engagement_id", e.id).eq("status", "paid"),
    admin.from("engagements").select("gift_currency").eq("id", e.id).maybeSingle(),
  ]);
  const giftCents = ((contribs ?? []) as { amount_cents: number }[]).reduce((a, c) => a + (c.amount_cents || 0), 0);
  // Who's in the winning photo, if the entrant named them (a parent entering a child).
  const { data: entry } = await admin
    .from("responses")
    .select("content")
    .eq("engagement_id", e.id)
    .eq("user_id", winnerUid)
    .maybeSingle();
  const subject = ((entry?.content as { subject?: string } | null)?.subject || "").trim() || null;
  const shared = {
    groupName,
    title: e.title,
    url: engUrl,
    winnerName: who,
    byScore,
    prize,
    prizeText,
    imageUrl: `${base}/api/campfire/winner-image/${e.id}?w=${winnerUid.slice(0, 8)}`,
    giftCents,
    giftCurrency: (eg?.gift_currency as string | null) ?? "usd",
    subject,
  };
  let sent = 0;
  // Winner: the celebration.
  if (winnerEmail) {
    const w = contestWinnerEmail({ forWinner: true, ...shared });
    await sendCampfireBatch([
      { from, to: [winnerEmail], subject: w.subject, text: w.text, html: w.html, ...mailDefaults() },
    ]);
    sent++;
  }
  // Everyone else: the announcement.
  const others = (await getGroupMemberEmails(admin, e.group_id)).filter(
    (x) => !winnerEmail || x.toLowerCase() !== winnerEmail.toLowerCase()
  );
  const a = contestWinnerEmail({ forWinner: false, ...shared });
  for (let i = 0; i < others.length; i += 100) {
    await sendCampfireBatch(
      others.slice(i, i + 100).map((to) => ({
        from, to: [to], subject: a.subject, text: a.text, html: a.html, ...mailDefaults(),
      }))
    );
  }
  sent += others.length;
  // Phones too.
  const { data: gm } = await admin.from("group_members").select("user_id").eq("group_id", e.group_id);
  const rest = ((gm ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((u) => u !== winnerUid);
  await pushToUsers([winnerUid], { title: "🏆 You won!", body: `Your entry won "${e.title}" 🎉`, link: engUrl }).catch(() => 0);
  await pushToUsers(rest, { title: "🏆 We have a winner", body: `${subject ?? who} won "${e.title}" — see the winning entry.`, link: engUrl }).catch(() => 0);
  return { sent };
}
