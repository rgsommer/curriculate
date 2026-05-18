// POST { code } — require a current TOTP code to disable 2FA on your own account.
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
  try {
    const dbi = await db();
    const user: any = await dbi.collection("users").findOne({ _id: new ObjectId(u.uid) });
    if (!user?.totp_enabled || !user.totp_secret) {
      return NextResponse.json({ error: "2FA isn't currently enabled on this account." }, { status: 409 });
    }
    if (!authenticator.check(code, user.totp_secret)) {
      return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
    }
    await dbi.collection("users").updateOne({ _id: user._id }, {
      $unset: { totp_secret: "", totp_enabled: "", totp_enrolled_at: "", totp_pending_secret: "", totp_pending_at: "" },
    });
    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "user.2fa_disabled",
      resource_type: "user", resource_id: u.uid,
      details: null,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
