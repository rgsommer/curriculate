import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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

// Backfill / self-heal: scan recent Stripe Checkout sessions and mark any
// gift contribution paid that Stripe says is paid but our DB still has pending.
// Use this to recover chip-ins that completed before the webhook (or the
// return-trip fallback) existed. Idempotent — safe to re-run anytime.
//
//   curl -s -X POST "https://www.curriculate.net/api/campfire/gift/reconcile?days=30" \
//     -H "authorization: Bearer $CRON_SECRET"
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "30"), 1), 365);
  // Stripe `created` is seconds. Date.now() is unavailable in workflow scripts but
  // this is a normal route handler, so it's fine here.
  const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  const stripe = getStripe();
  const admin = getAdmin();

  let scanned = 0;
  let giftSessions = 0;
  let paidFixed = 0;
  let alreadyPaid = 0;
  const fixed: Array<{ contribution_id: string; amount_cents: number | null }> = [];

  let startingAfter: string | undefined;
  // Page through recent sessions (newest first). Cap pages so a runaway can't hang.
  for (let page = 0; page < 50; page++) {
    const batch = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: since },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const s of batch.data) {
      scanned++;
      if (s.metadata?.kind !== "gift_contribution") continue;
      if (s.payment_status !== "paid") continue;
      const contributionId = s.metadata?.contribution_id;
      if (!contributionId) continue;
      giftSessions++;

      // Only touch rows still pending (idempotent; never un-refund).
      const { data: row } = await admin
        .from("campfire_gift_contributions")
        .select("id, status, amount_cents")
        .eq("id", contributionId)
        .single();
      if (!row) continue;
      if (row.status === "paid") {
        alreadyPaid++;
        continue;
      }
      if (row.status === "refunded") continue;

      const { error: uErr } = await admin
        .from("campfire_gift_contributions")
        .update({
          status: "paid",
          stripe_session_id: s.id,
          stripe_payment_intent: (s.payment_intent as string | null) ?? null,
        })
        .eq("id", contributionId)
        .neq("status", "refunded");
      if (!uErr) {
        paidFixed++;
        fixed.push({
          contribution_id: contributionId,
          amount_cents: (row.amount_cents as number | null) ?? null,
        });
      }
    }
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
  }

  return NextResponse.json({
    ok: true,
    days,
    scanned,
    giftSessions,
    paidFixed,
    alreadyPaid,
    fixed,
  });
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("Gift reconcile error:", e);
    return NextResponse.json({ error: "Reconcile failed." }, { status: 500 });
  }
}

// GET allowed too, for an easy browser/curl trigger (same bearer required).
export async function GET(req: Request) {
  return POST(req);
}
