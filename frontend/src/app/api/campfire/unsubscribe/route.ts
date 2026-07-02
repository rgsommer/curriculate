import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Records an email opt-out (from the /campfire/unsubscribe page, or a mail client's
// List-Unsubscribe one-click POST). Opt-out only — safe direction; a suppressed user just
// stops receiving Campfire mail and can be re-invited later.
async function optOut(emailRaw: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, status: 500, error: "Not configured" };
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }
  const admin = createClient(url, key);
  const { error } = await admin
    .from("campfire_email_optouts")
    .upsert({ email, reason: "user" }, { onConflict: "email" });
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200 };
}

export async function POST(req: Request) {
  let email = new URL(req.url).searchParams.get("e") || "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (!email && ct.includes("application/json")) {
      email = (await req.json())?.email || "";
    } else if (!email) {
      const form = await req.formData().catch(() => null);
      if (form) email = String(form.get("email") || "");
    }
  } catch {
    /* fall through with whatever we have */
  }
  const r = await optOut(email);
  return NextResponse.json({ ok: r.ok, error: r.error }, { status: r.status });
}
