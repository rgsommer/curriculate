// GET → { user, engagements }. Admins (clearance>=3) see every engagement;
// audit_client users see only the ones linked to them.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../teebeepay/_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dbi = await db();
    const userRow: any = await dbi.collection("users").findOne({ email: u.email });
    let engagements: any[] = [];
    if (u.clearance >= 3) {
      engagements = await dbi.collection("audit_engagements").find({})
        .sort({ created_at: -1 }).limit(200).toArray();
    } else if (userRow?.audit_engagements?.length) {
      engagements = await dbi.collection("audit_engagements").find({
        _id: { $in: userRow.audit_engagements },
      }).sort({ created_at: -1 }).toArray();
    }
    return NextResponse.json({
      user: {
        uid: u.uid, email: u.email, role: u.role, clearance: u.clearance,
        first_name: userRow?.first_name || "", last_name: userRow?.last_name || "",
      },
      engagements: engagements.map((e: any) => ({
        id: e._id.toString(),
        status: e.status,
        company_name: e.company_name,
        audit_type: e.audit_type,
        fy_end: e.fy_end,
        agreed_fee: e.agreed_fee ?? null,
        indicative_fee_low: e.indicative_fee_low ?? null,
        indicative_fee_high: e.indicative_fee_high ?? null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
