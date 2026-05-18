// GET single employee + full payroll history (one row per pay period).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ eid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { eid } = await params;
  try {
    const dbi = await db();
    const emp: any = await dbi.collection("employees").findOne({ _id: new ObjectId(eid) });
    if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (u.clearance < 3 && u.company_id !== emp.company_id.toString()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if ((emp.clearance_level || 0) >= u.clearance) {
      return NextResponse.json({ error: "Above your clearance" }, { status: 403 });
    }

    // Company + department + job-function (for display)
    const company: any = await dbi.collection("companies").findOne({ _id: emp.company_id });
    const dept = emp.department_id ? await dbi.collection("departments").findOne({ _id: emp.department_id }) : null;
    const job  = emp.job_function_id ? await dbi.collection("job_functions").findOne({ _id: emp.job_function_id }) : null;

    // Full payroll history
    const entries: any[] = await dbi.collection("payroll_entries")
      .find({ employee_id: emp._id }).toArray();
    const periodIds = entries.map((e) => e.pay_period_id);
    const periods: any[] = periodIds.length
      ? await dbi.collection("pay_periods").find({ _id: { $in: periodIds } }).toArray()
      : [];
    const pMap = Object.fromEntries(periods.map((p) => [p._id.toString(), p]));

    const history = entries.map((e: any) => {
      const p = pMap[e.pay_period_id.toString()] || {};
      return {
        entry_id: e._id.toString(),
        pay_period_id: e.pay_period_id.toString(),
        period_start: p.period_start || null,
        period_end:   p.period_end   || null,
        pay_date:     p.pay_date     || null,
        status:       p.status       || "historical",
        hours: e.hours, cash_advance: e.cash_advance, note: e.note,
        gross: e.gross, tax: e.tax, nasfund: e.nasfund,
        other_deductions: e.other_deductions, net: e.net,
        imported: !!p.imported_from,
      };
    }).sort((a, b) => (b.pay_date || b.period_end || "").localeCompare(a.pay_date || a.period_end || ""));

    const lifetime = history.reduce((acc, h) => ({
      gross: acc.gross + (Number(h.gross) || 0),
      tax: acc.tax + (Number(h.tax) || 0),
      nasfund: acc.nasfund + (Number(h.nasfund) || 0),
      net: acc.net + (Number(h.net) || 0),
    }), { gross: 0, tax: 0, nasfund: 0, net: 0 });

    return NextResponse.json({
      employee: {
        id: emp._id.toString(),
        company_id: emp.company_id.toString(),
        company_name: company?.name || "",
        first_name: emp.first_name, last_name: emp.last_name,
        email: emp.email, phone: emp.phone, dob: emp.dob,
        start_date: emp.start_date, end_date: emp.end_date,
        is_active: emp.is_active !== 0,
        pay_type: emp.pay_type,
        annual_salary: emp.annual_salary, hourly_rate: emp.hourly_rate,
        default_hours: emp.default_hours, fte_pct: emp.fte_pct,
        dependents: emp.dependents,
        residency_status: emp.residency_status, declaration_lodged: emp.declaration_lodged,
        bank_account_no: emp.bank_account_no, bank_account_name: emp.bank_account_name,
        branch_code: emp.branch_code, bank_code: emp.bank_code,
        bank_accounts: emp.bank_accounts || null,
        department: dept?.name || null,
        job_function: job?.name || null,
        notes: emp.notes || null,
      },
      history, lifetime,
    });
  } catch (e: any) {
    console.error("[teebeepay/employee] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
