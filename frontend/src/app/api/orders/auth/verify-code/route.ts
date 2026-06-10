// POST { email, token, code } -> verifies the code, returns a 12h session token.
import { NextResponse } from "next/server";
import {
  clientIp, rateOk, normalizeEmail, verifyToken, codeHash, makeSessionToken,
} from "../../_auth";
import { getConfig } from "../../_db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();
  const payload = verifyToken(body.token);

  if (!payload || payload.k !== "code" || payload.email !== email) {
    return NextResponse.json({ error: "Your code expired. Please request a new one." }, { status: 401 });
  }
  if (!/^\d{6}$/.test(code) || codeHash(code, email) !== payload.ch) {
    return NextResponse.json({ error: "That code is incorrect. Please check and try again." }, { status: 401 });
  }

  const { financeEmail } = await getConfig();
  return NextResponse.json({
    ok: true,
    session: makeSessionToken(email),
    email,
    isAdmin: email === normalizeEmail(financeEmail),
  });
}
