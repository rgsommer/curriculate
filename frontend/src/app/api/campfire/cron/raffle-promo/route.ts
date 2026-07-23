import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  campfireFrom,
  mailDefaults,
  raffleReferrerEmail,
} from "@/lib/campfire/serverInvites";
import { sendCampfireBatch } from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

// One-time feature announcement: tell referral partners about Raffle Challenges and
// hand each a prospect-ready deep link (their code baked in: ?start=raffle-challenge).
// SAFE BY DEFAULT — previews (renders + counts) unless called with ?send=1, so a
// stray hit never blasts. Deduped per partner via last_promo_campaign = "raffle-launch".
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey);
  const site = (
    process.env.CAMPFIRE_PUBLIC_URL || "https://www.curriculate.net"
  ).replace(/\/$/, "");
  const from = campfireFrom();
  const send = new URL(req.url).searchParams.get("send") === "1";
  const CAMPAIGN = "raffle-launch";
  const linkFor = (code: string) =>
    `${site}/campfirelive?start=raffle-challenge&ref=${encodeURIComponent(code)}`;

  const { data: refs } = await admin
    .from("campfire_referrers")
    .select("code, email, name, last_promo_campaign, active");
  const targets = (refs ?? []).filter(
    (r) => r.active && r.email && r.last_promo_campaign !== CAMPAIGN
  );

  // Preview (default): render a sample, report who would receive it. No send.
  if (!send) {
    const sample = raffleReferrerEmail({
      name: "there",
      link: linkFor("YOURCODE"),
    });
    return NextResponse.json({
      ok: true,
      preview: true,
      wouldSendTo: targets.length,
      subject: sample.subject,
      text: sample.text,
      hint: "Add ?send=1 to actually send.",
    });
  }

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, note: "Nobody left to send to." });
  }

  const msgs = targets.map((r) => {
    const em = raffleReferrerEmail({
      name: r.name as string | null,
      link: linkFor(r.code as string),
    });
    return {
      from,
      to: [r.email as string],
      subject: em.subject,
      text: em.text,
      html: em.html,
      ...mailDefaults(),
    };
  });

  let sent = 0;
  for (let i = 0; i < msgs.length; i += 100) {
    const { error } = await sendCampfireBatch(msgs.slice(i, i + 100));
    if (error) {
      console.error("Raffle promo send error:", error);
      break;
    }
    sent += msgs.slice(i, i + 100).length;
  }
  if (sent > 0) {
    await admin
      .from("campfire_referrers")
      .update({ last_promo_campaign: CAMPAIGN })
      .in(
        "code",
        targets.slice(0, sent).map((r) => r.code)
      );
  }

  return NextResponse.json({ ok: true, sent });
}
