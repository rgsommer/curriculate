import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  campfireFrom,
  mailDefaults,
  referralPromoEmail,
} from "@/lib/campfire/serverInvites";
import { sendCampfireBatch } from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

function authorized(req: Request) {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

const mmdd = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;

// Daily: ~4 weeks before end of school (teacher-gift season) and 4 weeks before
// Christmas, email each active referral partner a ready-to-post message with their
// referral link baked in. Deduped per campaign so it sends once.
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
  // The public Campfire app URL for the referral link. Deliberately NOT
  // NEXT_PUBLIC_SITE_URL — that's pointed at the API/backend host in this project,
  // which would produce dead links. CAMPFIRE_PUBLIC_URL (a runtime, non-public var)
  // can override; otherwise the canonical site.
  const site = (
    process.env.CAMPFIRE_PUBLIC_URL || "https://www.curriculate.net"
  ).replace(/\/$/, "");
  const from = campfireFrom();

  const now = new Date();
  const year = now.getUTCFullYear();
  const today = mmdd(now);
  const qs = new URL(req.url).searchParams;
  const manual = qs.get("campaign"); // "school" | "xmas" → force-send now (auth'd)
  const preview = qs.get("preview") === "1"; // render + count, don't send

  // The send window for a campaign: from 4 weeks (28 days) before the anchor up to
  // the anchor itself. Firing anywhere in the window (not just on day 1) means a
  // missed daily run — or a late start — self-heals; the per-partner dedupe below
  // keeps it to a single email each per season.
  const fourWeeksBefore = (m: number, d: number) => {
    const dt = new Date(Date.UTC(year, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 28);
    return mmdd(dt);
  };
  const inWindow = (m: number, d: number) => {
    const anchor = new Date(Date.UTC(year, m - 1, d, 23, 59, 59));
    const start = new Date(anchor);
    start.setUTCDate(start.getUTCDate() - 28);
    return now >= start && now <= anchor;
  };
  // School-end anchor is configurable (default late June, Ontario-ish).
  const [sm, sd] = (process.env.REFERRAL_SCHOOL_END || "06-26")
    .split("-")
    .map((n) => parseInt(n, 10));
  const schoolPromo = fourWeeksBefore(sm || 6, sd || 26);
  const xmasPromo = fourWeeksBefore(12, 25);

  let campaign: "school" | "xmas" | null = null;
  if (manual === "school" || manual === "xmas") campaign = manual;
  else if (inWindow(sm || 6, sd || 26)) campaign = "school";
  else if (inWindow(12, 25)) campaign = "xmas";
  if (!campaign) {
    return NextResponse.json({ ok: true, sent: 0, today, schoolPromo, xmasPromo });
  }
  const campaignId = `${campaign}-${year}`;

  // Preview: render the email for a sample link, list how many would receive it.
  if (preview) {
    const { data: prefs } = await admin
      .from("campfire_referrers")
      .select("code", { count: "exact", head: false })
      .eq("active", true);
    const sample = referralPromoEmail({
      name: "there",
      link: `${site}/campfirelive?ref=YOURCODE`,
      campaign,
    });
    return NextResponse.json({
      ok: true,
      preview: true,
      campaign: campaignId,
      wouldSendTo: (prefs ?? []).length,
      subject: sample.subject,
      text: sample.text,
    });
  }

  const { data: refs } = await admin
    .from("campfire_referrers")
    .select("code, email, name, last_promo_campaign, active");
  const targets = (refs ?? []).filter(
    (r) => r.active && r.email && r.last_promo_campaign !== campaignId
  );
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, campaign: campaignId });
  }

  const msgs = targets.map((r) => {
    const em = referralPromoEmail({
      name: r.name as string | null,
      link: `${site}/campfirelive?ref=${encodeURIComponent(r.code as string)}`,
      campaign: campaign!,
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
      console.error("Referral promo send error:", error);
      break;
    }
    sent += msgs.slice(i, i + 100).length;
  }
  // Mark these partners as having received this campaign.
  if (sent > 0) {
    await admin
      .from("campfire_referrers")
      .update({ last_promo_campaign: campaignId })
      .in(
        "code",
        targets.slice(0, sent).map((r) => r.code)
      );
  }

  return NextResponse.json({ ok: true, sent, campaign: campaignId });
}
