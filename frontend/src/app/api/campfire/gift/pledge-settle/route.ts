import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { issueGiftCard, giftProviderConfigured } from "@/lib/campfire/gifts";
import { pledgeOf } from "@/lib/campfire/types";
import {
  getGroupMemberEmails,
  campfireFrom,
  campfireSiteUrl,
  mailDefaults,
  escapeHtml,
} from "@/lib/campfire/serverInvites";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
  });
}
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
const resend = new Resend(process.env.RESEND_API_KEY);

// Settle a Pledge Drive: the host posts the actual result; each pledge is reduced
// to what's owed (per-unit → min(actual × rate, charged); lump → unchanged) and the
// shortfall is auto-refunded. The recipient is then paid the total, and the group is
// thanked. Idempotent: amounts are reduced in place and gift_issued_at guards re-run.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    const actualUnits = Math.max(0, Math.round(Number(body?.actualUnits)));
    if (!engagementId || !Number.isFinite(actualUnits)) {
      return NextResponse.json({ error: "Missing engagement or result." }, { status: 400 });
    }

    const admin = getAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: eng } = await admin
      .from("engagements")
      .select(
        "id, group_id, creator_id, title, config, gift_currency, gift_recipient_email, gift_recipient_name, gift_issued_at"
      )
      .eq("id", engagementId)
      .single();
    if (!eng) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (eng.creator_id !== uid) {
      return NextResponse.json({ error: "Only the host can post the result." }, { status: 403 });
    }
    const pledge = pledgeOf(eng.config as Record<string, unknown> | null);
    if (!pledge) {
      return NextResponse.json({ error: "Not a pledge drive." }, { status: 400 });
    }
    if (eng.gift_issued_at) {
      return NextResponse.json({ ok: true, alreadySettled: true });
    }

    // Settle each paid pledge: reduce to what's owed, refund the shortfall.
    const { data: contribs } = await admin
      .from("campfire_gift_contributions")
      .select("id, amount_cents, pledge_per_unit_cents, stripe_payment_intent")
      .eq("engagement_id", engagementId)
      .eq("status", "paid");

    const stripe = getStripe();
    let totalOwed = 0;
    let refundedCount = 0;
    for (const c of contribs ?? []) {
      const charged = (c.amount_cents as number) || 0;
      const perUnit = (c.pledge_per_unit_cents as number) || 0;
      // Per-unit owes min(actual × rate, what we charged); a lump owes the full amount.
      const owed = perUnit > 0 ? Math.min(actualUnits * perUnit, charged) : charged;
      const refund = charged - owed;
      if (refund > 0) {
        const pi = c.stripe_payment_intent as string | null;
        if (pi) {
          try {
            await stripe.refunds.create({ payment_intent: pi, amount: refund });
            refundedCount++;
          } catch (e) {
            console.error(`Pledge partial refund failed for ${c.id}:`, e);
            continue; // leave amount as-is; host can retry
          }
        }
        await admin
          .from("campfire_gift_contributions")
          .update({ amount_cents: owed })
          .eq("id", c.id);
      }
      totalOwed += owed;
    }

    // Pay the recipient the settled total (Tremendous), then mark settled.
    let issued = false;
    if (
      totalOwed > 0 &&
      eng.gift_recipient_email &&
      giftProviderConfigured()
    ) {
      const result = await issueGiftCard({
        amountCents: totalOwed,
        currency: (eng.gift_currency as string | null) ?? "usd",
        recipientEmail: eng.gift_recipient_email as string,
        recipientName: (eng.gift_recipient_name as string | null) ?? undefined,
        note: `Your "${eng.title}" pledge drive raised this — ${actualUnits} ${pledge.unit}s! 🎉`,
        idempotencyKey: `${eng.id}:pledge`,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 502 });
      }
      issued = true;
    }

    const nowIso = new Date().toISOString();
    await admin
      .from("engagements")
      .update({
        status: "revealed",
        ...(issued ? { gift_issued_at: nowIso } : {}),
        config: {
          ...((eng.config as Record<string, unknown>) ?? {}),
          pledge: { ...pledge, actualUnits, settledAt: nowIso },
        },
      })
      .eq("id", engagementId);

    // Thank everyone + celebrate.
    try {
      const emails = await getGroupMemberEmails(admin, eng.group_id as string);
      const url = `${campfireSiteUrl()}/campfirelive/group/${eng.group_id}/engagement/${eng.id}`;
      const amt = `${(eng.gift_currency as string || "usd").toUpperCase()} $${(totalOwed / 100).toFixed(2)}`;
      const subject = `🎉 "${eng.title}" — ${actualUnits} ${pledge.unit}s, thank you!`;
      const text = `The pledge drive is done — ${actualUnits} ${pledge.unit}s achieved, raising ${amt} for ${eng.gift_recipient_name || "the participant"}. Sponsors were charged for what was achieved (shortfalls refunded). Thank you! ${url}`;
      const html = `<p>🎉 <b>${escapeHtml(eng.title as string)}</b> is done — <b>${actualUnits} ${escapeHtml(pledge.unit)}s</b> achieved, raising <b>${amt}</b> for ${escapeHtml(eng.gift_recipient_name as string || "the participant")}.</p><p>Sponsors were charged only for what was achieved — any shortfall was refunded automatically. Thank you for your support! 🙌</p><p><a href="${url}">See the result →</a></p>`;
      const from = campfireFrom();
      for (let i = 0; i < emails.length; i += 100) {
        await resend.batch.send(
          emails.slice(i, i + 100).map((to) => ({ from, to: [to], subject, text, html, ...mailDefaults() }))
        );
      }
    } catch (e) {
      console.error("Pledge settle notify failed:", e);
    }

    return NextResponse.json({ ok: true, totalOwed, refundedCount, issued });
  } catch (e) {
    console.error("Pledge settle error:", e);
    return NextResponse.json({ error: "Couldn't settle the drive." }, { status: 500 });
  }
}
