import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  campfireFrom,
  mailDefaults,
  campfireSiteUrl,
  referrerWelcomeEmail,
  sendCampfireBatch,
} from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Upsert a referral partner from the Curriculate agent system into campfire_referrers
// so the SAME code earns on Campfire chip-ins and receives the seasonal promo. The
// backend admin calls this when an agent code is created / updated / disabled /
// deleted. Auth: a shared bearer secret (REFERRAL_SYNC_SECRET) set on both apps.
export async function POST(req: Request) {
  const secret = process.env.REFERRAL_SYNC_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name =
    typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;
  // Default active=true; a disable/delete passes active=false.
  const active = body?.active === undefined ? true : !!body.active;

  if (!code || !email) {
    return NextResponse.json(
      { error: "code and email are required" },
      { status: 400 }
    );
  }

  const admin = getAdmin();
  // Is this a brand-new partner? (Decides whether to send the welcome below.)
  const { data: existing } = await admin
    .from("campfire_referrers")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  const isNew = !existing;

  // Upsert by code. Only the provided columns are written, so an existing row's
  // user_id / last_promo_campaign / created_at are preserved.
  const { error } = await admin
    .from("campfire_referrers")
    .upsert({ code, email, name, active }, { onConflict: "code" });
  if (error) {
    console.error("Referrer sync error:", error);
    return NextResponse.json({ error: "Upsert failed" }, { status: 500 });
  }

  // New + active partner → send the one-time full-opportunity welcome.
  let welcomed = false;
  if (isNew && active) {
    try {
      const em = referrerWelcomeEmail({ name, code, site: campfireSiteUrl() });
      await sendCampfireBatch([
        {
          from: campfireFrom(),
          to: [email],
          subject: em.subject,
          text: em.text,
          html: em.html,
          ...mailDefaults(email),
        },
      ]);
      welcomed = true;
    } catch (e) {
      console.error("Referrer welcome email failed:", e);
    }
  }

  return NextResponse.json({ ok: true, code, active, welcomed });
}
