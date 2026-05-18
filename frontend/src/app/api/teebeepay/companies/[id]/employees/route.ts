// frontend/src/app/api/teebeepay/companies/[id]/employees/route.ts
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

/* GET — list employees the authed user can see (clearance-filtered). */
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
    const rows = await dbi.collection("employees").find({
      company_id: cid,
      $or: [{ clearance_level: { $lt: u.clearance } }, { clearance_level: { $exists: false } }],
    }).sort({ is_active: -1, last_name: 1, first_name: 1 }).toArray();
    return NextResponse.json({
      employees: rows.map((e: any) => ({
        id: e._id.toString(),
        first_name: e.first_name, last_name: e.last_name,
        email: e.email || null,
        dob: e.dob || null,
        pay_type: e.pay_type || "hourly",
        annual_salary: e.annual_salary || null,
        hourly_rate: e.hourly_rate || null,
        default_hours: e.default_hours || null,
        dependents: e.dependents || 0,
        is_active: e.is_active !== 0,
        bank_account_no: e.bank_account_no || null,
        bank_account_name: e.bank_account_name || null,
        branch_code: e.branch_code || null,
        bank_accounts: e.bank_accounts || null,
        housing_allowance: e.housing_allowance || 0,
        meals_allowance: e.meals_allowance || 0,
        school_fees_allowance: e.school_fees_allowance || 0,
        salary_sacrifice: e.salary_sacrifice || 0,
        ncsl_voluntary: e.ncsl_voluntary || 0,
        division: e.division || "",
        supervisor_id: e.supervisor_id ? e.supervisor_id.toString() : null,
        supervisor_submits_hours: !!e.supervisor_submits_hours,
      })),
    });
  } catch (e: any) {
    console.error("[teebeepay/employees GET] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/* POST — create an employee (bookkeeper+). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const b = await req.json().catch(() => ({} as any));
  if (!b.first_name || !b.last_name) {
    return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
  }

  try {
    const dbi = await db();
    const num = (v: any) => v != null && v !== "" ? Number(v) : null;
    const doc = {
      company_id: new ObjectId(id),
      first_name: String(b.first_name).trim(),
      last_name: String(b.last_name).trim(),
      email: b.email ? String(b.email).trim().toLowerCase() : null,
      dob: b.dob || null,
      start_date: b.start_date || null,
      pay_type: b.pay_type === "salary" ? "salary" : "hourly",
      annual_salary: b.pay_type === "salary" ? num(b.annual_salary) : null,
      hourly_rate:   b.pay_type === "hourly" ? num(b.hourly_rate)   : null,
      default_hours: num(b.default_hours),
      fte_pct: num(b.fte_pct) || 100,
      dependents: Number(b.dependents || 0),
      residency_status: b.residency_status === "non_resident" ? "non_resident" : "resident",
      declaration_lodged: b.declaration_lodged !== false,
      bank_account_no: b.bank_account_no ? String(b.bank_account_no).trim() : null,
      bank_account_name: b.bank_account_name ? String(b.bank_account_name).trim() : null,
      branch_code: b.branch_code ? String(b.branch_code).trim() : null,
      bank_code: b.bank_code || "088",
      housing_allowance: num(b.housing_allowance) || 0,
      vehicle_allowance: num(b.vehicle_allowance) || 0,
      fuel_allowance: num(b.fuel_allowance) || 0,
      meals_allowance: num(b.meals_allowance) || 0,
      school_fees_allowance: num(b.school_fees_allowance) || 0,
      salary_sacrifice: num(b.salary_sacrifice) || 0,
      ncsl_voluntary: num(b.ncsl_voluntary) || 0,
      savings_deduction: num(b.savings_deduction) || 0,
      loan_repayment: num(b.loan_repayment) || 0,
      nas_extra_pct: num(b.nas_extra_pct) || 0,
      clearance_level: Math.min(Number(b.clearance_level || 0), u.clearance - 1),
      is_active: 1,
      created_at: new Date(),
      division: b.division ? String(b.division).trim().slice(0, 80) : null,
      supervisor_id: b.supervisor_id ? new ObjectId(String(b.supervisor_id)) : null,
      supervisor_submits_hours: !!b.supervisor_submits_hours,
    };
    const r = await dbi.collection("employees").insertOne(doc);
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    console.error("[teebeepay/employees POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
