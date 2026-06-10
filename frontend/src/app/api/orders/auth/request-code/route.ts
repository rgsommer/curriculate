// POST { email } -> emails a 6-digit login code, returns a 10-min code token.
import { NextResponse } from "next/server";
import { clientIp, rateOk, isEmail, normalizeEmail, newCode, makeCodeToken } from "../../_auth";
import { getConfig } from "../../_db";
import { sendEmail, pageShell } from "../../_email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    return NextResponse.json({ error: "Too many code requests. Please wait a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const code = newCode();
  const token = makeCodeToken(email, code);
  const { schoolName } = await getConfig();

  const html = pageShell(
    "Your sign-in code",
    `<p style="margin:0 0 12px">Enter this code on the supply ordering page to sign in:</p>
     <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f3f4f6;border-radius:10px;padding:16px;text-align:center">${code}</div>
     <p style="margin:14px 0 0;font-size:13px;color:#6b7280">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`,
    schoolName
  );

  const res = await sendEmail({ to: email, subject: `Your ordering sign-in code: ${code}`, html });

  // Always return the token. If email couldn't be sent (no key in dev), surface a
  // hint so local testing still works, but never leak the code in production.
  return NextResponse.json({
    ok: true,
    token,
    emailed: res.ok,
    ...(res.skipped && process.env.NODE_ENV !== "production" ? { devCode: code } : {}),
  });
}
