// GET → signed-in employee user's own pay history. Matches by email
// against the `employees` collection (one user email may match one or
// more employee records across companies if the same person works for
// multiple client companies).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const dbi = await db();
    const emps: any[] = await dbi.collection("employees")
      .find({ email: (u.email || "").toLowerCase() }).toArray();
    if (!emps.length) {
      return NextResponse.json({ employees: [], stubs: [] });
    }
    const empIds = emps.map((e) => e._id);
    const companies: any[] = await dbi.collection("companies")
      .find({ _id: { $in: emps.map((e) => e.company_id) } }).toArray();
    const cMap = Object.fromEntries(companies.map((c) => [c._id.toString(), c]));

    const entries: any[] = await dbi.collection("payroll_entries")
      .find({ employee_id: { $in: empIds } }).toArray();
    const periodIds = entries.map((e) => e.pay_period_id);
    const periods: any[] = periodIds.length
      ? await dbi.collection("pay_periods").find({ _id: { $in: periodIds } }).toArray()
      : [];
    const pMap = Object.fromEntries(periods.map((p) => [p._id.toString(), p]));
    const empMap = Object.fromEntries(emps.map((e) => [e._id.toString(), e]));

    const stubs = entries
      .map((e: any) => {
        const p = pMap[e.pay_period_id.toString()] || {};
        const emp = empMap[e.employee_id.toString()] || {};
        const co = cMap[(emp.company_id || "").toString()] || {};
        return {
          entry_id: e._id.toString(),
          pay_period_id: e.pay_period_id.toString(),
          period_start: p.period_start || null,
          period_end:   p.period_end   || null,
          pay_date:     p.pay_date     || null,
          status:       p.status       || "historical",
          imported:     !!p.imported_from,
          company: { id: co._id?.toString(), name: co.name, currency: co.currency || "PGK" },
          employee_name: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
          hours: e.hours, gross: e.gross, tax: e.tax, nasfund: e.nasfund,
          other_deductions: e.other_deductions, net: e.net,
          note: e.note,
        };
      })
      .sort((a, b) => (b.pay_date || b.period_end || "").localeCompare(a.pay_date || a.period_end || ""));

    return NextResponse.json({
      employees: emps.map((e) => ({
        id: e._id.toString(),
        first_name: e.first_name, last_name: e.last_name,
        company_id: e.company_id.toString(),
        company_name: cMap[e.company_id.toString()]?.name || "",
      })),
      stubs,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
