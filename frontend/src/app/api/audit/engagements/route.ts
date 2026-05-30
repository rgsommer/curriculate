// GET → list every audit engagement (Principal+).
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("audit_engagements").find({})
      .sort({ created_at: -1 }).limit(200).toArray();
    return NextResponse.json({
      engagements: rows.map((r: any) => ({
        id: r._id.toString(),
        status: r.status,
        company_name: r.company_name,
        contact_name: r.contact_name,
        contact_email: r.contact_email,
        contact_phone: r.contact_phone || null,
        contact_role: r.contact_role || null,
        audit_type: r.audit_type,
        revenue_band: r.revenue_band,
        employee_count: r.employee_count ?? null,
        fy_end: r.fy_end || null,
        notes: r.notes || null,
        indicative_fee_low:  r.indicative_fee_low ?? null,
        indicative_fee_high: r.indicative_fee_high ?? null,
        agreed_fee: r.agreed_fee ?? null,
        admin_notes: r.admin_notes || null,
        created_at: r.created_at,
        updated_at: r.updated_at || null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
