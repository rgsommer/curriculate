// frontend/src/app/api/teebeepay/companies/[id]/route.ts
// GET single company + PATCH to update.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const dbi = await db();
    const c: any = await dbi.collection("companies").findOne({ _id: new ObjectId(id) });
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ company: { ...c, id: c._id.toString(), _id: undefined } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  const $set: any = {};
  const fields = [
    "name", "abbreviation", "pay_interval", "default_hours", "currency",
    "bank_code", "branch_code", "bank_account_no", "bank_account_name", "bank_client_no",
    "office_email", "manager_email", "payslip_message", "ncsl_employer_no",
  ];
  for (const k of fields) {
    if (k in b) $set[k] = typeof b[k] === "string" ? b[k].trim() : b[k];
  }
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  if (!Object.keys($set).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  $set.updated_at = new Date();
  try {
    const dbi = await db();
    await dbi.collection("companies").updateOne({ _id: new ObjectId(id) }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
