// GET → { user, meta }. Principal+ (firm-internal loan-prep workspace).
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";
import { PURPOSE_OPTIONS, PACKAGE_CHECKLIST } from "../_scoring";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const userRow: any = await dbi.collection("users").findOne({ email: u.email });
    return NextResponse.json({
      user: {
        uid: u.uid, email: u.email, role: u.role, clearance: u.clearance,
        first_name: userRow?.first_name || "", last_name: userRow?.last_name || "",
      },
      meta: { purpose_options: PURPOSE_OPTIONS, package_checklist: PACKAGE_CHECKLIST },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
