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

  const { data: contribs } = await admin
    .from("campfire_gift_contributions")
    .select("user_id, amount_cents")
    .eq("engagement_id", eng.id)
    .eq("status", "paid")
    .not("user_id", "is", null);
  const totals: Record<string, number> = {};
  for (const c of contribs ?? []) {
    const cu = c.user_id as string;
    totals[cu] = (totals[cu] ?? 0) + ((c.amount_cents as number) || 0);
  }
  const uids = Object.keys(totals);
  if (uids.length === 0) return { ok: false, error: "Nobody's chipped in yet." };

  // Weighted by amount (default) or one entry each.
  const weighted = raffle.drawWeighted !== false;
  let winnerUid = uids[uids.length - 1];
  if (weighted) {
    const totalWeight = uids.reduce((s, x) => s + totals[x], 0);
    let r = Math.random() * totalWeight;
    for (const x of uids) {
      r -= totals[x];
      if (r <= 0) {
        winnerUid = x;
        break;
      }
    }
  } else {
    winnerUid = uids[Math.floor(Math.random() * uids.length)];
  }

  const { data: wUser } = await admin.auth.admin.getUserById(winnerUid);
  let winnerEmail = wUser?.user?.email || null;
  let winnerName =
    (wUser?.user?.user_metadata?.name as string | undefined) || undefined;
  const { data: wGm } = await admin
    .from("group_members")
    .select("notify_email, display_name")
    .eq("group_id", eng.group_id)
    .eq("user_id", winnerUid)
    .maybeSingle();
  if (!winnerEmail) winnerEmail = (wGm?.notify_email as string | null) || null;
  winnerName = winnerName || (wGm?.display_name as string | undefined) || undefined;

  const totalCents = Object.values(totals).reduce((a, b) => a + b, 0);
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

  const nowIso = new Date().toISOString();
  await admin
    .from("engagements")
    .update({
      status: "revealed",
      ...(issued ? { gift_issued_at: nowIso } : {}),
      gift_recipient_email: winnerEmail,
      gift_recipient_name: winnerName ?? null,
      config: {
        ...(eng.config ?? {}),
        raffle: { ...raffle, winnerUserId: winnerUid },
      },
    })
    .eq("id", eng.id);

  try {
    const emails = await getGroupMemberEmails(admin, eng.group_id);
    const url = `${campfireSiteUrl()}/campfirelive/group/${eng.group_id}/engagement/${eng.id}`;
    const pot = `${currency.toUpperCase()} $${(winnerCents / 100).toFixed(2)}`;
    const who = winnerName || "The winner";
    const subject = `🎟️ We have a raffle winner — "${eng.title}"`;
    const text = `${who} won the ${pot} raffle pot for "${eng.title}"! ${url}`;
    const html = `<p>🎟️ <b>${escapeHtml(who)}</b> won the ${pot} raffle pot for "${escapeHtml(
      eng.title
    )}"! 🎉</p><p><a href="${url}">See it →</a></p>`;
    const from = campfireFrom();
    for (let i = 0; i < emails.length; i += 100) {
      await resend.batch.send(
        emails.slice(i, i + 100).map((to) => ({ from, to: [to], subject, text, html, ...mailDefaults() }))
      );
    }
  } catch (e) {
    console.error("Raffle draw notify failed:", e);
  }

  return { ok: true, winnerUserId: winnerUid, winnerCents };
}
