// GET → returns the divisions where the authed user is the supervisor (with
// supervisor_submits_hours = true), grouped by company, with the team members
// and any pending hours already queued for the next pay run.
//
// A user is a "supervisor" iff there exists an employee row with email = u.email
// AND some division has supervisor_employee_id = that employee._id.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dbi = await db();

    // 1. find all employee rows whose email matches the caller (one or more
    //    companies — the same person may exist as an employee in multiple
    //    client books).
    const myEmployees: any[] = await dbi.collection("employees")
      .find({ email: u.email }).toArray();
    if (!myEmployees.length) return NextResponse.json({ teams: [] });
    const myIds = myEmployees.map((e) => e._id);

    // 2. divisions where I'm the supervisor + the supervisor-submits-hours flag is on
    const divisions: any[] = await dbi.collection("divisions").find({
      supervisor_employee_id: { $in: myIds },
      supervisor_submits_hours: true,
      $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
    }).toArray();
    if (!divisions.length) return NextResponse.json({ teams: [] });

    // 3. companies for those divisions, and the employees in each division
    const companyIds = Array.from(new Set(divisions.map((d) => d.company_id.toString())))
      .map((s) => new ObjectId(s));
    const companies: any[] = await dbi.collection("companies").find({ _id: { $in: companyIds } }).toArray();
    const cMap = Object.fromEntries(companies.map((c: any) => [c._id.toString(), c]));

    const teamEmployees: any[] = await dbi.collection("employees").find({
      division_id: { $in: divisions.map((d) => d._id) },
      $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
    }).sort({ last_name: 1, first_name: 1 }).toArray();

    const byDivision: Record<string, any[]> = {};
    for (const e of teamEmployees) {
      const k = e.division_id.toString();
      (byDivision[k] = byDivision[k] || []).push(e);
    }

    return NextResponse.json({
      teams: divisions.map((d: any) => {
        const company = cMap[d.company_id.toString()] || {};
        return {
          company_id: d.company_id.toString(),
          company_name: company.name || "",
          company_currency: company.currency || "PGK",
          division_id: d._id.toString(),
          division_name: d.name,
          default_hours: d.default_hours ?? 80,
          employees: (byDivision[d._id.toString()] || []).map((e: any) => ({
            id: e._id.toString(),
            first_name: e.first_name, last_name: e.last_name,
            email: e.email || null,
            pay_type: e.pay_type || "hourly",
            hourly_rate: e.hourly_rate || null,
            annual_salary: e.annual_salary || null,
            default_hours: e.default_hours || d.default_hours || 80,
            pending_hours: e.pending_hours ?? null,
            pending_cash_advance: e.pending_cash_advance ?? null,
            pending_note: e.pending_note || "",
            pending_hours_at: e.pending_hours_at || null,
          })),
        };
      }),
    });
  } catch (e: any) {
    console.error("[teebeepay/supervisor/team] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
