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
    // Robust lookup: some legacy records use a plain-string `_id`, and the JWT
    // uid may have drifted from the persisted record. Email is the ground truth.
    const candidates: any[] = [];
    try { candidates.push({ _id: new ObjectId(u.uid) }); } catch {}
    candidates.push({ _id: u.uid as any });
    if (u.email) candidates.push({ email: u.email });
    const row: any = await dbi.collection("users").findOne({ $or: candidates });
    return NextResponse.json({
      user: {
        uid: row ? row._id.toString() : u.uid,
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
