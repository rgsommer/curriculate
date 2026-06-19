import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { issueGiftCard, giftProviderConfigured } from "./gifts";
import {
  getGroupMemberEmails,
  campfireFrom,
  campfireSiteUrl,
  mailDefaults,
  escapeHtml,
  notifyHostOfAward,
} from "./serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

type HofEng = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  config: Record<string, unknown> | null;
  gift_currency: string | null;
  gift_issued_at: string | null;
};

// Award the pooled gift card to the winner of the host-chosen Hall of Fame award.
// Votes live in responses.content.answers as { awardIndex: winnerUserId }; the winner
// is the most-voted member for config.hofGiftAward (self-votes excluded). Idempotent
// via gift_issued_at, mirroring the raffle draw.
export async function awardHallOfFameGift(
  admin: SupabaseClient,
  eng: HofEng
): Promise<{ ok: boolean; error?: string; winnerUserId?: string }> {
  if (eng.gift_issued_at) return { ok: true };
  const cfg = (eng.config ?? {}) as { hofGiftAward?: number; questions?: string[] };
  const awardIdx = cfg.hofGiftAward;
  if (awardIdx === undefined || awardIdx === null)
    return { ok: false, error: "No prize award set." };

  // Tally votes for that award by normalized name (votes are names — members,
  // invitees, or write-ins all count).
  const { data: resp } = await admin
    .from("responses")
    .select("content")
    .eq("engagement_id", eng.id);
  const counts: Record<string, { label: string; n: number }> = {};
  for (const r of resp ?? []) {
    const answers = (r.content as { answers?: Record<string, string> } | null)?.answers;
    const name = (answers?.[String(awardIdx)] ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!counts[key]) counts[key] = { label: name, n: 0 };
    counts[key].n++;
  }
  const ranked = Object.values(counts).sort((a, b) =>
    b.n !== a.n ? b.n - a.n : a.label.localeCompare(b.label)
  );
  const awardLabel = cfg.questions?.[awardIdx] ?? "the prize award";

  if (ranked.length === 0) {
    // Nobody got a vote — close it out, nothing to pay.
    await admin
      .from("engagements")
      .update({
        config: { ...(eng.config ?? {}), hofWinner: { award: awardIdx, name: null } },
      })
      .eq("id", eng.id);
    return { ok: true };
  }
  const winnerName: string = ranked[0].label;

  // Resolve the winning NAME to a payable group member (matching the per-group
  // display name or their account name, like the app shows). Anyone not matched
  // (e.g. an invitee who hasn't joined, or a write-in) can't be auto-paid.
  let winnerUserId: string | null = null;
  let winnerEmail: string | null = null;
  const { data: gms } = await admin
    .from("group_members")
    .select("user_id, display_name, notify_email")
    .eq("group_id", eng.group_id);
  for (const gm of gms ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(gm.user_id as string);
    const authName = (u?.user?.user_metadata?.name as string | undefined) || "";
    const name = ((gm.display_name as string | null) || authName || "").trim();
    if (name && name.toLowerCase() === winnerName.toLowerCase()) {
      winnerUserId = gm.user_id as string;
      winnerEmail =
        u?.user?.email || (gm.notify_email as string | null) || null;
      break;
    }
  }

  // Sum the pot (paid contributions).
  const { data: contribs } = await admin
    .from("campfire_gift_contributions")
    .select("amount_cents")
    .eq("engagement_id", eng.id)
    .eq("status", "paid");
  const totalCents = (contribs ?? []).reduce(
    (a, c) => a + ((c.amount_cents as number) || 0),
    0
  );
  const currency = eng.gift_currency ?? "usd";

  let issued = false;
  if (totalCents > 0 && winnerEmail && giftProviderConfigured()) {
    const result = await issueGiftCard({
      amountCents: totalCents,
      currency,
      recipientEmail: winnerEmail,
      recipientName: winnerName,
      note: `🏅 You won "${awardLabel}" in "${eng.title}"!`,
      idempotencyKey: `${eng.id}:hof`,
    });
    if (!result.ok) return { ok: false, error: result.error };
    issued = true;
  }
  // Winner picked but no auto-pay (no email / provider off / empty pot) → host settles.
  const winnerUnpaid = totalCents > 0 && !issued;

  const nowIso = new Date().toISOString();
  await admin
    .from("engagements")
    .update({
      // Mark settled whether auto-issued OR handed to the host — stops the cron from
      // re-processing (and re-emailing) the same award every run.
      ...(issued || winnerUnpaid ? { gift_issued_at: nowIso } : {}),
      gift_recipient_email: winnerEmail,
      gift_recipient_name: winnerName ?? null,
      config: {
        ...(eng.config ?? {}),
        hofWinner: {
          award: awardIdx,
          userId: winnerUserId,
          name: winnerName,
          unpaid: winnerUnpaid,
        },
      },
    })
    .eq("id", eng.id);

  // No auto-pay → email the host the winner's details so they send the gift card.
  if (winnerUnpaid) {
    await notifyHostOfAward(admin, {
      creatorId: eng.creator_id,
      groupId: eng.group_id,
      engagementId: eng.id,
      engagementTitle: eng.title,
      award: awardLabel,
      recipientName: winnerName,
      recipientEmail: winnerEmail,
      amountCents: totalCents,
      currency,
    });
  }

  // Tell the group who won the prize.
  try {
    const emails = await getGroupMemberEmails(admin, eng.group_id);
    const url = `${campfireSiteUrl()}/campfirelive/group/${eng.group_id}/engagement/${eng.id}`;
    const who = winnerName || "The winner";
    const pot =
      totalCents > 0 ? `${currency.toUpperCase()} $${(totalCents / 100).toFixed(2)}` : "";
    const prizeNote = winnerUnpaid
      ? ` The host will arrange the ${pot} prize.`
      : issued
      ? ` A ${pot} gift card is on its way! 🎁`
      : "";
    const subject = `🏅 "${awardLabel}" winner — "${eng.title}"`;
    const text = `${who} won "${awardLabel}" in "${eng.title}"!${prizeNote} ${url}`;
    const html = `<p>🏅 <b>${escapeHtml(who)}</b> won <b>${escapeHtml(
      awardLabel
    )}</b> in "${escapeHtml(eng.title)}"! 🎉</p>${
      prizeNote ? `<p>${escapeHtml(prizeNote.trim())}</p>` : ""
    }<p><a href="${url}">See the results →</a></p>`;
    const from = campfireFrom();
    for (let i = 0; i < emails.length; i += 100) {
      await resend.batch.send(
        emails
          .slice(i, i + 100)
          .map((to) => ({ from, to: [to], subject, text, html, ...mailDefaults() }))
      );
    }
  } catch (e) {
    console.error("Hall of Fame notify failed:", e);
  }

  return { ok: true, winnerUserId: winnerUserId ?? undefined };
}
