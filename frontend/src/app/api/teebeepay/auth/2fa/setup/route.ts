// POST → generate a new TOTP secret + otpauth URL + QR-code data URL.
// User scans the QR with Google Authenticator / Authy / 1Password, then
// POSTs to /verify-setup with a 6-digit code to confirm and enable.
import { NextResponse } from "next/server";
import { authenticator } from "../../_totp";
import QRCode from "qrcode";
import { readAuth, db, ObjectId } from "../../../_auth";

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(u.email, "TeebeePay", secret);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, scale: 6, color: { dark: "#0f172a", light: "#ffffff" } });

    // Stash a *pending* secret on the user doc; only confirmed if verify-setup succeeds.
    const dbi = await db();
    await dbi.collection("users").updateOne({ _id: new ObjectId(u.uid) }, {
      $set: { totp_pending_secret: secret, totp_pending_at: new Date() },
    });

    return NextResponse.json({ ok: true, secret, otpauth, qr });
  } catch (e: any) {
    console.error("[2fa/setup] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
