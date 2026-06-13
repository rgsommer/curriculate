import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { issueGiftCard, giftProviderConfigured } from "@/lib/campfire/gifts";
import { raffleOf } from "@/lib/campfire/types";
import {
  getGroupMemberEmails,
  campfireFrom,
  campfireSiteUrl,
  mailDefaults,
  escapeHtml,
} from "@/lib/campfire/serverInvites";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
const resend = new Resend(process.env.RESEND_API_KEY);

// Raffle Draw: pick a random winner among everyone who chipped in (weighted by amount
// or one-each) and pay them the pot. Host-triggered — the host draws the winner at the
// event ("declare it at dinner"). Idempotent via the gift_issued_at guard.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }
    const admin = getAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: eng } = await admin
      .from("engagements")
      .select("id, group_id, creator_id, title, config, gift_currency, gift_issued_at")
      .eq("id", engagementId)
      .single();
    if (!eng) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (eng.creator_id !== uid) {
      return NextResponse.json({ error: "Only the host can draw." }, { status: 403 });
    }
    const raffle = raffleOf(eng.config as Record<string, unknown> | null);
    if (!raffle?.draw) {
      return NextResponse.json({ error: "Not a raffle draw." }, { status: 400 });
    }
    if (eng.gift_issued_at) {
      return NextResponse.json({ ok: true, alreadyDrawn: true });
    }

    // Everyone who chipped in (paid), totalled per person.
    const { data: contribs } = await admin
      .from("campfire_gift_contributions")
      .select("user_id, amount_cents")
      .eq("engagement_id", engagementId)
      .eq("status", "paid")
      .not("user_id", "is", null);
    const totals: Record<string, number> = {};
    for (const c of contribs ?? []) {
      const cu = c.user_id as string;
      totals[cu] = (totals[cu] ?? 0) + ((c.amount_cents as number) || 0);
    }
    const uids = Object.keys(totals);
    if (uids.length === 0) {
      return NextResponse.json({ error: "Nobody's chipped in yet." }, { status: 400 });
    }

    // Pick the winner: weighted by amount (default) or one entry each.
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

    // Resolve the winner's email + name.
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
    const currency = (eng.gift_currency as string | null) ?? "usd";

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
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 502 });
      }
      issued = true;
      if (hostCents > 0) {
        const { data: hUser } = await admin.auth.admin.getUserById(
          eng.creator_id as string
        );
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
          ...((eng.config as Record<string, unknown>) ?? {}),
          raffle: { ...raffle, winnerUserId: winnerUid },
        },
      })
      .eq("id", engagementId);

    // Announce the winner.
    try {
      const emails = await getGroupMemberEmails(admin, eng.group_id as string);
      const url = `${campfireSiteUrl()}/campfirelive/group/${eng.group_id}/engagement/${eng.id}`;
      const pot = `${currency.toUpperCase()} $${(winnerCents / 100).toFixed(2)}`;
      const who = winnerName || "The winner";
      const subject = `🎟️ We have a raffle winner — "${eng.title}"`;
      const text = `${who} won the ${pot} raffle pot for "${eng.title}"! ${url}`;
      const html = `<p>🎟️ <b>${escapeHtml(who)}</b> won the ${pot} raffle pot for "${escapeHtml(
        eng.title as string
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

    return NextResponse.json({ ok: true, winnerUserId: winnerUid, winnerCents, issued });
  } catch (e) {
    console.error("Raffle draw error:", e);
    return NextResponse.json({ error: "Couldn't draw the winner." }, { status: 500 });
  }
}
