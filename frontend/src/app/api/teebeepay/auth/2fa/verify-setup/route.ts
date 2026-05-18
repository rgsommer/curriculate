// POST { code } — validate the 6-digit code against the pending secret;
// on success, move pending → confirmed and flag the user as 2FA-enabled.
import { NextResponse } from "next/server";
import { authenticator } from "../../_totp";
import { readAuth, db, ObjectId } from "../../../_auth";
import { logAudit } from "../../../_audit";

authenticator.options = { window: 1 };

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const code = String(b.code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });

  try {
    const dbi = await db();
    const user: any = await dbi.collection("users").findOne({ _id: new ObjectId(u.uid) });
    if (!user?.totp_pending_secret) {
      return NextResponse.json({ error: "Start enrolment again — no pending secret." }, { status: 409 });
    }
    if (!authenticator.check(code, user.totp_pending_secret)) {
      return NextResponse.json({ error: "Code didn't match. Try again with a fresh code." }, { status: 401 });
    }
    // Confirm
    await dbi.collection("users").updateOne({ _id: user._id }, {
      $set: {
        totp_secret: user.totp_pending_secret,
        totp_enabled: 1,
        totp_enrolled_at: new Date(),
      },
      $unset: { totp_pending_secret: "", totp_pending_at: "" },
    });
    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "user.2fa_enabled",
      resource_type: "user", resource_id: u.uid,
      details: null,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[2fa/verify-setup] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
