// GET  → list every audit engagement (Principal+).
// POST → create an engagement directly (Principal+) — for the auditor adding a
//        client they've signed an engagement letter with, without the public
//        intake form.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";
import { logAudit } from "../../teebeepay/_audit";

const VALID_TYPES = ["statutory", "readiness", "tax", "compliance", "donor_fund", "landowner", "other"];
const VALID_STATUS = ["inquiry", "engaged", "active", "review", "delivered", "lost"];

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

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const company_name = String(b.company_name || "").trim().slice(0, 200);
  if (!company_name) return NextResponse.json({ error: "Company name is required." }, { status: 400 });

  const audit_type = VALID_TYPES.includes(b.audit_type) ? b.audit_type : "readiness";
  const status     = VALID_STATUS.includes(b.status) ? b.status : "engaged";
  const email      = String(b.contact_email || "").trim().toLowerCase().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid contact email, or leave it blank." }, { status: 400 });
  }

  try {
    const dbi = await db();
    const doc: any = {
      status,
      company_name,
      contact_name:  String(b.contact_name || "").trim().slice(0, 120),
      contact_email: email,
      contact_phone: String(b.contact_phone || "").trim().slice(0, 40),
      contact_role:  String(b.contact_role || "").trim().slice(0, 120),
      audit_type,
      revenue_band:  String(b.revenue_band || "unknown"),
      employee_count: b.employee_count ? Number(b.employee_count) : null,
      fy_end:        String(b.fy_end || "").trim().slice(0, 60) || null,
      notes:         String(b.notes || "").trim().slice(0, 4000) || null,
      agreed_fee:    (b.agreed_fee === "" || b.agreed_fee == null) ? null : Number(b.agreed_fee),
      created_at: new Date(),
      created_by: u.email,
      source: "admin",   // distinguishes auditor-created from public-intake inquiries
    };
    const r = await dbi.collection("audit_engagements").insertOne(doc);
    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "audit.create_engagement",
      resource_type: "audit_engagement", resource_id: r.insertedId.toString(),
      details: { company_name, audit_type, status },
    }).catch(() => {});
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
