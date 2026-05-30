// PATCH a single engagement — Principal+ can move it through the lifecycle
// (inquiry → engaged → active → review → delivered) and adjust the agreed fee
// or write admin notes.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../teebeepay/_auth";

const STATUSES = ["inquiry", "engaged", "active", "review", "delivered", "lost"];
const SETTABLE = ["status", "agreed_fee", "admin_notes", "company_name", "contact_name",
                   "contact_email", "contact_phone", "contact_role", "audit_type",
                   "revenue_band", "fy_end", "notes", "employee_count"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date(), updated_by: u.email };
  for (const k of SETTABLE) {
    if (k in b) {
      const v = b[k];
      if (k === "status") {
        if (!STATUSES.includes(v)) return NextResponse.json({ error: `Unknown status: ${v}` }, { status: 400 });
        $set.status = v;
      } else if (k === "agreed_fee" || k === "employee_count") {
        $set[k] = v === "" || v == null ? null : Number(v) || 0;
      } else {
        $set[k] = typeof v === "string" ? v.trim() : v;
      }
    }
  }
  try {
    const dbi = await db();
    await dbi.collection("audit_engagements").updateOne(
      { _id: new ObjectId(id) }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    const row: any = await dbi.collection("audit_engagements").findOne({ _id: new ObjectId(id) });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ engagement: { ...row, id: row._id.toString(), _id: undefined } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
