// POST { token } -> exchange an existing Curriculate/Behaviours JWT for an orders
// session, so teachers already signed in elsewhere on curriculate.net don't need a
// 6-digit code. We validate the token server-to-server against the backend's
// signature-verified GET /api/me and trust the email it returns.
import { NextResponse } from "next/server";
import { makeSessionToken, normalizeEmail, isEmail } from "../../_auth";
import { getConfig } from "../../_db";

export const runtime = "nodejs";

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://api.curriculate.net";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "");
  if (!token) return NextResponse.json({ error: "No token." }, { status: 400 });

  let me: any = null;
  try {
    const r = await fetch(`${BACKEND}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      // never cache an auth check
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    me = await r.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Could not verify your sign-in." }, { status: 502 });
  }

  const email = normalizeEmail(me?.user?.email);
  if (!me?.ok || !isEmail(email)) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { financeEmail } = await getConfig();
  return NextResponse.json({
    ok: true,
    session: makeSessionToken(email),
    email,
    name: me?.user?.name || "",
    isAdmin: email === normalizeEmail(financeEmail),
  });
}
