// GET  -> { financeEmail, schoolName }  (public; needed to show defaults on setup)
// POST { session, financeEmail?, schoolName? } -> save (admin session required)
//
// "Admin" = a valid session whose email equals the CURRENT finance email. The very
// first time (before anything is configured) the bootstrap default finance email
// holder can sign in and set the real one.
import { NextResponse } from "next/server";
import { sessionEmail, normalizeEmail, isEmail } from "../_auth";
import { getConfig, saveConfig } from "../_db";

export const runtime = "nodejs";

export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json(cfg);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = sessionEmail(body.session);
  if (!email) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const cfg = await getConfig();
  if (normalizeEmail(email) !== normalizeEmail(cfg.financeEmail)) {
    return NextResponse.json(
      { error: `Only the finance account (${cfg.financeEmail}) can change settings.` },
      { status: 403 }
    );
  }

  const patch: { financeEmail?: string; financeName?: string; schoolName?: string } = {};
  if (body.financeEmail !== undefined) {
    const fe = normalizeEmail(body.financeEmail);
    if (!isEmail(fe)) return NextResponse.json({ error: "Enter a valid finance email." }, { status: 400 });
    patch.financeEmail = fe;
  }
  if (body.financeName !== undefined) {
    patch.financeName = String(body.financeName).trim().slice(0, 120);
  }
  if (body.schoolName !== undefined) {
    const sn = String(body.schoolName).trim().slice(0, 120);
    if (sn) patch.schoolName = sn;
  }

  const next = await saveConfig(patch);
  return NextResponse.json({ ok: true, ...next });
}
