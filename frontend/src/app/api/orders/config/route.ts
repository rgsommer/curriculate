// GET  -> { financeEmail, schoolName }  (public; needed to show defaults on setup)
// POST { session, financeEmail?, schoolName? } -> save (admin session required)
//
// "Admin" = a valid session whose email equals the CURRENT finance email. The very
// first time (before anything is configured) the bootstrap default finance email
// holder can sign in and set the real one.
import { NextResponse } from "next/server";
import { sessionEmail, normalizeEmail, isEmail } from "../_auth";
import { getConfig, saveConfig, isFinanceEmail, OrdersConfig } from "../_db";

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
  // Either finance person (primary or second) can change settings.
  if (!isFinanceEmail(email, cfg)) {
    return NextResponse.json(
      { error: `Only a finance account (${cfg.financeEmail}${cfg.financeEmail2 ? " / " + cfg.financeEmail2 : ""}) can change settings.` },
      { status: 403 }
    );
  }

  const patch: Partial<OrdersConfig> = {};
  if (body.financeEmail !== undefined) {
    const fe = normalizeEmail(body.financeEmail);
    if (!isEmail(fe)) return NextResponse.json({ error: "Enter a valid finance email." }, { status: 400 });
    patch.financeEmail = fe;
  }
  if (body.financeName !== undefined) {
    patch.financeName = String(body.financeName).trim().slice(0, 120);
  }
  // Second finance person — empty string clears it.
  if (body.financeEmail2 !== undefined) {
    const fe2 = normalizeEmail(body.financeEmail2);
    if (fe2 && !isEmail(fe2)) return NextResponse.json({ error: "Enter a valid second finance email (or leave it blank)." }, { status: 400 });
    patch.financeEmail2 = fe2;
  }
  if (body.financeName2 !== undefined) {
    patch.financeName2 = String(body.financeName2).trim().slice(0, 120);
  }
  // Per-person "receive order emails" toggles.
  if (body.financeNotify !== undefined) patch.financeNotify = !!body.financeNotify;
  if (body.financeNotify2 !== undefined) patch.financeNotify2 = !!body.financeNotify2;
  // Orders due-by date — accept YYYY-MM-DD or empty (clears it).
  if (body.dueDate !== undefined) {
    const d = String(body.dueDate).trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: "Enter a valid due date." }, { status: 400 });
    patch.dueDate = d;
  }
  if (body.schoolName !== undefined) {
    const sn = String(body.schoolName).trim().slice(0, 120);
    if (sn) patch.schoolName = sn;
  }

  const next = await saveConfig(patch);
  return NextResponse.json({ ok: true, ...next });
}
