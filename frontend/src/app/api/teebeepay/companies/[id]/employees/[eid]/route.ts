// frontend/src/app/api/teebeepay/companies/[id]/employees/[eid]/route.ts
// PATCH update; GET single employee.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";

const SETTABLE = [
  "first_name", "last_name", "email", "dob", "start_date", "end_date",
  "pay_type", "annual_salary", "hourly_rate", "default_hours", "fte_pct",
  "dependents", "residency_status", "declaration_lodged",
  "bank_account_no", "bank_account_name", "branch_code", "bank_code",
  "housing_allowance", "vehicle_allowance", "fuel_allowance", "meals_allowance",
  "school_fees_allowance", "leave_fares_allowance", "electricity_allowance",
  "gas_allowance", "phone_allowance", "airfares_allowance", "extra_allowance",
  "salary_sacrifice", "ncsl_voluntary", "nas_extra_pct",
  "savings_deduction", "christmas_bonus", "loan_repayment", "education_deduction",
];

export async function GET(req: Request, { params }: { params: Promise<{ id: string; eid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, eid } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const e: any = await dbi.collection("employees").findOne({ _id: new ObjectId(eid), company_id: new ObjectId(id) });
    if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((e.clearance_level || 0) >= u.clearance) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ employee: { ...e, id: e._id.toString(), _id: undefined } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; eid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, eid } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date() };
  for (const k of SETTABLE) {
    if (k in b) {
      const v = b[k];
      $set[k] = typeof v === "string" ? v.trim() : v;
      if (["annual_salary", "hourly_rate", "default_hours", "fte_pct", "dependents",
           "housing_allowance", "vehicle_allowance", "fuel_allowance", "meals_allowance",
           "school_fees_allowance", "leave_fares_allowance", "electricity_allowance",
           "gas_allowance", "phone_allowance", "airfares_allowance", "extra_allowance",
           "salary_sacrifice", "ncsl_voluntary", "nas_extra_pct",
           "savings_deduction", "christmas_bonus", "loan_repayment", "education_deduction",
          ].includes(k)) {
        $set[k] = v === "" || v == null ? null : Number(v);
      }
    }
  }
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  if ("division_id" in b) {
    $set.division_id = b.division_id ? new ObjectId(String(b.division_id)) : null;
  }
  try {
    const dbi = await db();
    await dbi.collection("employees").updateOne(
      { _id: new ObjectId(eid), company_id: new ObjectId(id) }, { $set }
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
