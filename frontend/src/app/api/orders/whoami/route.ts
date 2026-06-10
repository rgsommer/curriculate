// GET (?session=... or Authorization: Bearer) -> { ok, email, isAdmin }
// Live admin check so a newly-added finance person is recognised immediately,
// without having to sign out/in (the client caches isAdmin from login otherwise).
import { NextResponse } from "next/server";
import { sessionEmail } from "../_auth";
import { getConfig, isFinanceEmail } from "../_db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token =
    url.searchParams.get("session") ||
    req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ||
    "";
  const email = sessionEmail(token);
  if (!email) return NextResponse.json({ ok: false }, { status: 401 });
  const cfg = await getConfig();
  return NextResponse.json({ ok: true, email, isAdmin: isFinanceEmail(email, cfg) });
}
