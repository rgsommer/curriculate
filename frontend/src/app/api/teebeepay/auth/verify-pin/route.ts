// frontend/src/app/api/teebeepay/auth/verify-pin/route.ts
//
// POST { email, pin, token } → returns { authToken } if valid (8h lifetime).
import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import {
  clientIp, rateOk, pinHash, signToken, verifyToken, getSecret,
} from "../../_auth";

authenticator.options = { window: 1 };

interface PinTokenPayload {
  email: string;
  ph: string;
  uid: string;
  role: string;
  clearance: number;
  company_id: string | null;
  exp: number;
  stub?: boolean;
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (!rateOk(ip)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const body = await req.json().catch(() => ({} as any));
    const email = String(body.email || "").trim().toLowerCase();
    const pin   = String(body.pin   || "").trim();
    const token = String(body.token || "");
    if (!email || !pin || !token) {
      return NextResponse.json({ error: "Email, PIN and token are required." }, { status: 400 });
    }

    const secret = getSecret();
    const payload = verifyToken<PinTokenPayload>(token, secret);
    if (!payload || payload.stub) {
      return NextResponse.json({ error: "That code has expired or is invalid. Request a new one." }, { status: 401 });
    }
    if (payload.email !== email) {
      return NextResponse.json({ error: "Email does not match the PIN." }, { status: 401 });
    }
    const submitted = pinHash(pin, email, secret);
    if (submitted !== payload.ph) {
      return NextResponse.json({ error: "Incorrect PIN." }, { status: 401 });
    }

    // 2FA gate: if the user has TOTP enabled, require a valid totp code.
    try {
      const { db: dbFn, ObjectId } = await import("../../_auth");
      const dbi = await dbFn();
      const userRow: any = await dbi.collection("users").findOne({ _id: new ObjectId(payload.uid) });
      if (userRow?.totp_enabled && userRow?.totp_secret) {
        const totp = String(body.totp || "").replace(/\s/g, "");
        if (!totp) {
          return NextResponse.json({ error: "2fa_required", message: "Enter your authenticator code." }, { status: 401 });
        }
        if (!authenticator.check(totp, userRow.totp_secret)) {
          return NextResponse.json({ error: "Authenticator code didn't match." }, { status: 401 });
        }
      }
    } catch (e) {
      console.warn("[verify-pin] 2fa check failed open:", e);
    }

    const authToken = signToken({
      uid: payload.uid,
      email: payload.email,
      role: payload.role,
      clearance: payload.clearance,
      company_id: payload.company_id,
      exp: Date.now() + 8 * 60 * 60 * 1000,  // 8 hours
    }, secret);

    // Look up the user's name for the response (and record the sign-in).
    let first_name = "", last_name = "";
    try {
      const { db, ObjectId } = await import("../../_auth");
      const dbi = await db();
      const row: any = await dbi.collection("users").findOne({ _id: new ObjectId(payload.uid) });
      first_name = row?.first_name || "";
      last_name  = row?.last_name  || "";
      await dbi.collection("users").updateOne({ _id: new ObjectId(payload.uid) },
        { $set: { last_sign_in_at: new Date() } });
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      authToken,
      user: {
        uid: payload.uid, email: payload.email,
        role: payload.role, clearance: payload.clearance,
        company_id: payload.company_id,
        first_name, last_name,
      },
    });
  } catch (e) {
    console.error("[teebeepay/auth/verify-pin] error:", e);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true }); }
