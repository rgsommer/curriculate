// GET → { user, returns }. Principal+ (firm-internal tax workspace).
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";
import {
  STANDARD_ADJUSTMENTS, INDIVIDUAL_BRACKETS, TAX_TYPE_LABELS,
  COMPANY_RATE_RESIDENT, COMPANY_RATE_NONRESIDENT, GST_RATE,
} from "../_engine";

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
      meta: {
        type_labels: TAX_TYPE_LABELS,
        standard_adjustments: STANDARD_ADJUSTMENTS,
        individual_brackets: INDIVIDUAL_BRACKETS,
        rates: {
          company_resident: COMPANY_RATE_RESIDENT,
          company_nonresident: COMPANY_RATE_NONRESIDENT,
          gst: GST_RATE,
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
