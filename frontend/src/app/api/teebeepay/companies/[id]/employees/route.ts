// frontend/src/app/api/teebeepay/companies/[id]/employees/route.ts
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const cid = new ObjectId(id);
    if (u.clearance < 3 && u.company_id !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const dbi = await db();
    const filter: any = { company_id: cid, clearance_level: { $lt: u.clearance } };
    const rows = await dbi.collection("employees").find(filter)
      .sort({ is_active: -1, last_name: 1, first_name: 1 }).toArray();
    return NextResponse.json({
      employees: rows.map((e: any) => ({
        id: e._id.toString(),
        first_name: e.first_name, last_name: e.last_name,
        email: e.email || null,
        pay_type: e.pay_type || "hourly",
        annual_salary: e.annual_salary || null,
        hourly_rate: e.hourly_rate || null,
        default_hours: e.default_hours || null,
        is_active: e.is_active !== 0,
        bank_account_no: e.bank_account_no || null,
        bank_account_name: e.bank_account_name || null,
      })),
    });
  } catch (e: any) {
    console.error("[teebeepay/employees] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
