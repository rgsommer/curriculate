import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { issueGiftCard, giftProviderConfigured } from "./gifts";
import { raffleOf } from "./types";
import {
  getGroupMemberEmails,
  campfireFrom,
  campfireSiteUrl,
  mailDefaults,
  escapeHtml,
  notifyHostOfAward,
} from "./serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

type RaffleEng = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  config: Record<string, unknown> | null;
  gift_currency: string | null;
  gift_issued_at: string | null;
};

// Draw a random winner among everyone who chipped in (weighted by amount, default, or
// one-each) and pay them the pot via Tremendous. Shared by the host's manual draw
// (declare-at-event) and the cron auto-draw backstop. Idempotent via gift_issued_at.
export async function runRaffleDraw(
  admin: SupabaseClient,
  eng: RaffleEng
): Promise<{ ok: boolean; error?: string; winnerUserId?: string; winnerCents?: number }> {
  const raffle = raffleOf(eng.config);
  if (!raffle?.draw) return { ok: false, error: "Not a raffle draw." };
  if (eng.gift_issued_at) return { ok: true };

  // Everyone who chipped in (paid) — members (user_id) AND named anonymous (QR /give)
  // contributors are both eligible. Pool by identity, weighted by amount.
  type Contrib = {
    user_id: string | null;
    amount_cents: number | null;
    contributor_name: string | null;
    contributor_email?: string | null;
  };
  let contribs = (
    await admin
      .from("campfire_gift_contributions")
      .select("user_id, amount_cents, contributor_name, contributor_email")
      .eq("engagement_id", eng.id)
      .eq("status", "paid")
  ).data as Contrib[] | null;
  if (!contribs) {
    // contributor_email column not present yet (migration 068) — fall back without it.
    const fb = await admin
      .from("campfire_gift_contributions")
      .select("user_id, amount_cents, contributor_name")
      .eq("engagement_id", eng.id)
      .eq("status", "paid");
    contribs = (fb.data as Contrib[] | null) ?? null;
  }
  type Ident = {
    key: string;
    userId: string | null;
    name: string | null;
    email: string | null;
    cents: number;
  };
  const pool: Record<string, Ident> = {};
  for (const c of contribs ?? []) {
    const uidVal = (c.user_id as string | null) ?? null;
    const name = (c.contributor_name as string | null) ?? null;
    const email = (c.contributor_email as string | null) ?? null;
    // A member is always eligible; an anonymous entry needs a name to be drawable.
    if (!uidVal && !name) continue;
    const key = uidVal
      ? `u:${uidVal}`
      : `a:${(name || "").toLowerCase()}:${(email || "").toLowerCase()}`;
    const cents = (c.amount_cents as number) || 0;
    if (!pool[key]) pool[key] = { key, userId: uidVal, name, email, cents: 0 };
    pool[key].cents += cents;
    if (!pool[key].email && email) pool[key].email = email;
    if (!pool[key].name && name) pool[key].name = name;
  }
  const entries = Object.values(pool);
  if (entries.length === 0) return { ok: false, error: "Nobody's chipped in yet." };

  // Weighted by amount (default) or one entry each.
  const weighted = raffle.drawWeighted !== false;
  let winner = entries[entries.length - 1];
  if (weighted) {
    const totalWeight = entries.reduce((s, x) => s + x.cents, 0);
    let r = Math.random() * totalWeight;
    for (const x of entries) {
      r -= x.cents;
      if (r <= 0) {
        winner = x;
        break;
      }
    }
  } else {
    winner = entries[Math.floor(Math.random() * entries.length)];
  }

  // Resolve the winner's email + name (member account, or the anonymous details).
  let winnerEmail = winner.email || null;
  let winnerName = winner.name || undefined;
  if (winner.userId) {
    const { data: wUser } = await admin.auth.admin.getUserById(winner.userId);
    winnerEmail = wUser?.user?.email || winnerEmail;
    winnerName =
      (wUser?.user?.user_metadata?.name as string | undefined) || winnerName;
    const { data: wGm } = await admin
      .from("group_members")
      .select("notify_email, display_name")
      .eq("group_id", eng.group_id)
      .eq("user_id", winner.userId)
      .maybeSingle();
    if (!winnerEmail) winnerEmail = (wGm?.notify_email as string | null) || null;
    winnerName = winnerName || (wGm?.display_name as string | undefined) || undefined;
  }

  const totalCents = entries.reduce((a, b) => a + b.cents, 0);
  const hostPct = raffle.hostSplitPct ?? 0;
  const hostCents = Math.round((totalCents * hostPct) / 100);
  const winnerCents = totalCents - hostCents;
  const currency = eng.gift_currency ?? "usd";

  let issued = false;
  if (winnerCents > 0 && winnerEmail && giftProviderConfigured()) {
    const result = await issueGiftCard({
      amountCents: winnerCents,
      currency,
      recipientEmail: winnerEmail,
      recipientName: winnerName,
      note: `🎉 You won the "${eng.title}" raffle!`,
      idempotencyKey: `${eng.id}:raffle`,
    });
    if (!result.ok) return { ok: false, error: result.error };
    issued = true;
    if (hostCents > 0) {
      const { data: hUser } = await admin.auth.admin.getUserById(eng.creator_id);
      const hostEmail = hUser?.user?.email || null;
      if (hostEmail) {
        await issueGiftCard({
          amountCents: hostCents,
          currency,
          recipientEmail: hostEmail,
          note: `Host's ${hostPct}% share of the "${eng.title}" raffle.`,
          idempotencyKey: `${eng.id}:raffle-host`,
        });
      }
    }
  }
  // Winner picked but no way to auto-pay (no email / provider off) → host pays in person.
  const winnerUnpaid = winnerCents > 0 && !issued;

  const nowIso = new Date().toISOString();
  await admin
    .from("engagements")
    .update({
      status: "revealed",
      // Settled whether auto-issued OR handed to the host → no re-processing/re-email.
      ...(issued || winnerUnpaid ? { gift_issued_at: nowIso } : {}),
      gift_recipient_email: winnerEmail,
      gift_recipient_name: winnerName ?? null,
      config: {
        ...(eng.config ?? {}),
        raffle: {
          ...raffle,
          winnerUserId: winner.userId,
          winnerName: winner.userId ? null : winnerName ?? null,
          winnerUnpaid,
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
      award: "Raffle",
      recipientName: winnerName,
      recipientEmail: winnerEmail,
      amountCents: winnerCents,
      currency,
    });
  }

  try {
    const emails = await getGroupMemberEmails(admin, eng.group_id);
    const url = `${campfireSiteUrl()}/campfirelive/group/${eng.group_id}/engagement/${eng.id}`;
    const pot = `${currency.toUpperCase()} $${(winnerCents / 100).toFixed(2)}`;
    const who = winnerName || "The winner";
    const unpaidNote = winnerUnpaid
      ? ` The ${pot} gift card will be emailed to the winner shortly.`
      : "";
    const subject = `🎟️ We have a raffle winner — "${eng.title}"`;
    const text = `${who} won the ${pot} raffle pot for "${eng.title}"!${unpaidNote} ${url}`;
    const html = `<p>🎟️ <b>${escapeHtml(who)}</b> won the ${pot} raffle pot for "${escapeHtml(
      eng.title
    )}"! 🎉</p>${unpaidNote ? `<p>${escapeHtml(unpaidNote.trim())}</p>` : ""}<p><a href="${url}">See it →</a></p>`;
    const from = campfireFrom();
    for (let i = 0; i < emails.length; i += 100) {
      await resend.batch.send(
        emails.slice(i, i + 100).map((to) => ({ from, to: [to], subject, text, html, ...mailDefaults() }))
      );
    }
  } catch (e) {
    console.error("Raffle draw notify failed:", e);
  }

  return { ok: true, winnerUserId: winner.userId ?? undefined, winnerCents };
}
