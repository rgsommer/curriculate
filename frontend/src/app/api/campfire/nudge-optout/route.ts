import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { nudgeSig, type NudgeMeta } from "@/lib/campfire/nudges";
import { timingSafeEqual } from "crypto";

// "Stop these suggestions" from a dormant-group nudge email. GET shows a confirm
// button (mail scanners prefetch links — a GET alone must not opt anyone out);
// POST, with the signed token, sets app_metadata.cf_nudge.off for good.

const page = (title: string, body: string, form = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campfire</title></head>
<body style="margin:0;background:#fff7ed;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
<div style="max-width:440px;margin:15vh auto 0;padding:28px 24px;background:#fff;border-radius:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center;">
<div style="font-size:40px;">🔥</div><h1 style="font-size:20px;margin:8px 0;">${title}</h1><p style="color:#475569;margin:0 0 16px;">${body}</p>${form}
</div></body></html>`;

const html = (s: string, status = 200) =>
  new NextResponse(s, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

function valid(u: string, s: string) {
  if (!u || !s) return false;
  const want = Buffer.from(nudgeSig(u));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams;
  const u = qs.get("u") ?? "";
  const s = qs.get("s") ?? "";
  if (!valid(u, s)) return html(page("Link not valid", "This link has expired or is incomplete."), 400);
  const form = `<form method="POST"><input type="hidden" name="u" value="${u.replace(/[^a-zA-Z0-9-]/g, "")}"><input type="hidden" name="s" value="${s.replace(/[^a-zA-Z0-9_-]/g, "")}">
<button type="submit" style="border:0;border-radius:9999px;padding:12px 24px;font-weight:700;font-size:15px;color:#fff;background:#f97316;background-image:linear-gradient(to right,#f97316,#f43f5e);cursor:pointer;">Stop these suggestions</button></form>`;
  return html(
    page(
      "Stop group suggestions?",
      "We occasionally suggest something to start when one of your groups has gone quiet. You'll still get your normal Campfire emails.",
      form
    )
  );
}

export async function POST(req: Request) {
  const fd = await req.formData().catch(() => null);
  const u = String(fd?.get("u") ?? "");
  const s = String(fd?.get("s") ?? "");
  if (!valid(u, s)) return html(page("Link not valid", "This link has expired or is incomplete."), 400);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return html(page("Something went wrong", "Please try again later."), 500);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
  const { data } = await admin.auth.admin.getUserById(u);
  if (!data?.user) return html(page("Link not valid", "We couldn't find that account."), 400);
  const meta = (data.user.app_metadata as Record<string, unknown>) ?? {};
  const prev = (meta.cf_nudge as NudgeMeta | undefined) ?? {};
  await admin.auth.admin.updateUserById(u, { app_metadata: { ...meta, cf_nudge: { ...prev, off: true } } });
  return html(page("Done — no more suggestions", "You won't get “an idea for your group” emails again."));
}
