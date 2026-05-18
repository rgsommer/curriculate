// frontend/src/app/api/teebeepay/me/route.ts
// GET → { user } including the up-to-date first/last name from the DB.
// 401 if not authed.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dbi = await db();
    const row: any = await dbi.collection("users").findOne({ _id: new ObjectId(u.uid) });
    return NextResponse.json({
      user: {
        uid: u.uid,
        email: u.email,
        role: u.role,
        clearance: u.clearance,
        company_id: u.company_id,
        first_name: row?.first_name || "",
        last_name: row?.last_name || "",
        totp_enabled: !!row?.totp_enabled,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
