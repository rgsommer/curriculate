import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { campfireSiteUrl } from "@/lib/campfire/serverInvites";
import { isHouseSchool, raffleOf } from "@/lib/campfire/types";

// Lazy clients so a missing env var can't crash `next build`.
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

// Start a contribution: record it (pending) and open a Stripe Checkout for the amount.
// The webhook flips it to "paid" once Stripe confirms.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    // A Sign-up chip-in targets a specific gift row (engagement can have several).
    const giftId = typeof body?.giftId === "string" ? body.giftId : "";
    const amountCents = Number(body?.amountCents);
    const contributorName =
      typeof body?.contributorName === "string"
        ? body.contributorName.slice(0, 80)
        : null;
    const userId = typeof body?.userId === "string" ? body.userId : null;
    const email = typeof body?.email === "string" ? body.email : undefined;
    // Pledge Drive: a per-unit rate (0 = lump) + the sponsor's cap. Only sent for a
    // pledge — included in the insert conditionally so ordinary chip-ins never touch
    // these columns (they don't exist until migration 067 is applied).
    const pledgePerUnitCents = Math.max(0, Math.round(Number(body?.pledgePerUnitCents) || 0));
    const pledgeMaxCents = Math.max(0, Math.round(Number(body?.pledgeMaxCents) || 0));
    const isPledge = pledgeMaxCents > 0;
    // Redirect back to the exact host the user is on (always absolute, right scheme).
    const originIn =
      typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
        ? body.origin.replace(/\/$/, "")
        : null;

    if (!engagementId || !Number.isFinite(amountCents) || amountCents < 100) {
      return NextResponse.json(
        { error: "A valid engagement and amount (min $1) are required." },
        { status: 400 }
      );
    }
    if (amountCents > 50000) {
      return NextResponse.json({ error: "That's a bit much — max $500." }, { status: 400 });
    }

    const admin = getAdmin();
    const { data: eng } = await admin
      .from("engagements")
      .select("id, group_id, gift_enabled, title, gift_currency, config")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Activity not found." }, { status: 404 });
    }

    // Resolve which gift this contribution is for: a Sign-up chip-in (giftId → a
    // campfire_gifts row) or the engagement's embedded card gift (gift_enabled).
    let gift: { id: string; currency: string } | null = null;
    if (giftId) {
      const { data: g } = await admin
        .from("campfire_gifts")
        .select("id, engagement_id, currency, issued_at")
        .eq("id", giftId)
        .single();
      if (!g || g.engagement_id !== engagementId || g.issued_at) {
        return NextResponse.json(
          { error: "This chip-in isn't open." },
          { status: 400 }
        );
      }
      gift = { id: g.id as string, currency: (g.currency as string) ?? "usd" };
    } else if (!eng.gift_enabled) {
      return NextResponse.json(
        { error: "This activity isn't collecting a gift." },
        { status: 400 }
      );
    }
    const currency = (
      gift?.currency ??
      (eng.gift_currency as string | null) ??
      "usd"
    ).toLowerCase();

    // Service fee (added on top, never skimmed from the gift):
    //   • a base 1% PLATFORM fee on every chip-in, EXCEPT inside a "house" school
    //     (Brampton Christian / BCS), which is fully waived for conflict-of-interest.
    //   • if the group was started from a partner's referral link, the referrer's
    //     1% STACKS on top → organic = 1%, referred = 2% total. Referrer share is
    //     also waived inside a house school (those groups carry no referrer code).
    const { data: grp } = await admin
      .from("groups")
      .select("referrer_code, school")
      .eq("id", eng.group_id)
      .single();
    const houseSchool = isHouseSchool((grp?.school as string | null) ?? null);
    const referrerCode = houseSchool
      ? null
      : (grp?.referrer_code as string | null) || null;
    const PLATFORM_PCT = Number(process.env.CAMPFIRE_PLATFORM_PCT ?? "1") / 100;
    // Raffle Challenge chip-ins carry a higher referrer cut (the incentive to push
    // them to prospects); ordinary chip-ins use the standard 1%.
    const isRaffle = !!raffleOf(eng.config as Record<string, unknown> | null);
    const REFERRER_PCT =
      Number(
        isRaffle
          ? process.env.REFERRAL_REFERRER_PCT_RAFFLE ?? "3"
          : process.env.REFERRAL_REFERRER_PCT ?? "1"
      ) / 100;

    // The contributor covers the card-processing fee (+ the service fee), so the
    // recipient gets the FULL amount they chose. Gross up the Stripe charge so that,
    // after Stripe's 2.9% + $0.30, the platform nets gift + service fee.
    const giftCents = Math.round(amountCents); // counts toward the pool / gift card
    const platformCents = houseSchool ? 0 : Math.round(giftCents * PLATFORM_PCT);
    const referrerCutCents = referrerCode ? Math.round(giftCents * REFERRER_PCT) : 0;
    const serviceCents = platformCents + referrerCutCents;
    const FEE_PCT = Number(process.env.STRIPE_FEE_PCT ?? "2.9") / 100;
    const FEE_FIXED = Number(process.env.STRIPE_FEE_FIXED_CENTS ?? "30");
    const chargeCents = Math.ceil(
      (giftCents + serviceCents + FEE_FIXED) / (1 - FEE_PCT)
    );
    const feeCents = chargeCents - giftCents - serviceCents;

    // Record the pending contribution first so the webhook has a row to confirm.
    // amount_cents is the GIFT amount (what the recipient receives).
    const { data: contribution, error: cErr } = await admin
      .from("campfire_gift_contributions")
      .insert({
        engagement_id: engagementId,
        gift_id: gift?.id ?? null,
        user_id: userId,
        contributor_name: contributorName,
        amount_cents: giftCents,
        status: "pending",
        referrer_code: referrerCode,
        referrer_cut_cents: referrerCutCents,
        ...(isPledge
          ? {
              pledge_per_unit_cents: pledgePerUnitCents,
              pledge_max_cents: pledgeMaxCents,
            }
          : {}),
      })
      .select("id")
      .single();
    if (cErr || !contribution) {
      console.error("Gift contribution insert failed:", cErr);
      return NextResponse.json(
        { error: "Couldn't start the contribution: " + (cErr?.message ?? "unknown") },
        { status: 500 }
      );
    }

    const site = originIn || campfireSiteUrl();
    const back = `${site}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: chargeCents,
            product_data: {
              name: `Group gift — "${eng.title}"`,
              description:
                `$${(giftCents / 100).toFixed(2)} to the gift + $${(
                  feeCents / 100
                ).toFixed(2)} processing` +
                (serviceCents > 0
                  ? ` + $${(serviceCents / 100).toFixed(2)} service`
                  : "") +
                ` — the recipient gets the full amount.`,
            },
          },
        },
      ],
      metadata: {
        kind: "gift_contribution",
        contribution_id: contribution.id as string,
        engagement_id: engagementId,
      },
      success_url: `${back}?gift=thanks&cs={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}?gift=cancel`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("Gift checkout error:", e);
    return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
  }
}
