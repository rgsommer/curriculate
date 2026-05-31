// frontend/src/app/api/teebeepay/auth/request-pin/route.ts
//
// POST { email } -> emails a 6-digit PIN and returns a 10-min PIN token.
// The client posts the PIN + token back to /verify-pin to get a session token.
//
// If the email is rgsommer@me.com and no user exists in pngpay.users,
// we bootstrap a system_owner record so the very first login works.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  clientIp, rateOk, newPin, pinHash, signToken, getSecret, db, ROLE_CLEARANCE,
} from "../../_auth";

const FROM =
  process.env.RESEND_PNGPAY_FROM_ADDRESS ||
  process.env.RESEND_FROM_ADDRESS ||
  "TeebeePay <noreply@curriculate.net>";

const resend = new Resend(
  process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || ""
);

const BOOTSTRAP_OWNER = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || "rgsommer@me.com").toLowerCase();

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (!rateOk(ip)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const body = await req.json().catch(() => ({} as any));
    const emailRaw = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    const dbi = await db();
    const users = dbi.collection("users");

    // Bootstrap: if the request is from the configured owner email and no
    // user record exists, create one as system_owner.
    if (emailRaw === BOOTSTRAP_OWNER) {
      const exists = await users.findOne({ email: emailRaw });
      if (!exists) {
        await users.insertOne({
          email: emailRaw,
          role: "system_owner",
          company_id: null,
          is_active: 1,
          created_at: new Date(),
          bootstrap: true,
        });
      }
    }

    const user = await users.findOne({ email: emailRaw, is_active: { $ne: 0 } });
    if (!user) {
      // Don't reveal whether the email is known. Pretend success but never
      // actually send anything or issue a valid token.
      return NextResponse.json({
        ok: true,
        token: signToken({ stub: true, exp: Date.now() + 10 * 60 * 1000 }),
        hint: "If that email is registered, a PIN has been sent.",
      });
    }

    const pin = newPin();
    const secret = getSecret();
    const tokenPayload = {
      email: emailRaw,
      ph: pinHash(pin, emailRaw, secret),
      uid: String(user._id),
      role: user.role || "employee",
      clearance: ROLE_CLEARANCE[user.role || "employee"] ?? 0,
      company_id: user.company_id ? String(user.company_id) : null,
      exp: Date.now() + 10 * 60 * 1000, // 10 minutes
    };
    const token = signToken(tokenPayload, secret);

    // Email it
    if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: FROM,
          to: emailRaw,
          subject: `TeebeePay sign-in code: ${pin}`,
          html: `
            <p>Your TeebeePay sign-in code:</p>
            <p style="font:bold 26px/1 -apple-system,Segoe UI,Arial;letter-spacing:6px;background:#fef6dc;color:#0f2c52;padding:14px 20px;border-radius:10px;display:inline-block">${pin}</p>
            <p style="color:#555;font-size:13px">This code expires in 10 minutes. Didn't request it? Ignore this email.</p>
            <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">
              TeebeePay — payroll for PNG, by <a href="https://www.curriculate.net/teebee">TeeBee Accountants</a>.
            </p>
          `,
        });
      } catch (e) {
        console.error("[teebeepay/auth/request-pin] resend send failed:", e);
        return NextResponse.json({ error: "Unable to send the PIN email. Try again shortly." }, { status: 502 });
      }
    } else {
      console.warn("[teebeepay/auth/request-pin] no Resend key set — PIN was", pin);
    }

    return NextResponse.json({ ok: true, token });
  } catch (e) {
    console.error("[teebeepay/auth/request-pin] error:", e);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true }); }
