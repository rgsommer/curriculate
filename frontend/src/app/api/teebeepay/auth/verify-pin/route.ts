// frontend/src/app/api/teebeepay/auth/verify-pin/route.ts
//
// POST { email, pin, token } → returns { authToken } if valid (8h lifetime).
import { NextResponse } from "next/server";
import {
  clientIp, rateOk, pinHash, signToken, verifyToken, getSecret,
} from "../../_auth";

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

    const authToken = signToken({
      uid: payload.uid,
      email: payload.email,
      role: payload.role,
      clearance: payload.clearance,
      company_id: payload.company_id,
      exp: Date.now() + 8 * 60 * 60 * 1000,  // 8 hours
    }, secret);

    return NextResponse.json({
      ok: true,
      authToken,
      user: {
        uid: payload.uid, email: payload.email,
        role: payload.role, clearance: payload.clearance,
        company_id: payload.company_id,
      },
    });
  } catch (e) {
    console.error("[teebeepay/auth/verify-pin] error:", e);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true }); }
