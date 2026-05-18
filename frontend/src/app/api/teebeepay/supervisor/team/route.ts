// GET → returns the divisions where the authed user is the supervisor (with
// supervisor_submits_hours = true), grouped by company, with the team members
// and any pending hours already queued for the next pay run.
//
// A user is a "supervisor" iff there exists an employee row with email = u.email
// AND some division has supervisor_employee_id = that employee._id.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

// Defaults if a company hasn't customised them yet. Matches PNG Employment Act
// minimums plus the obvious unpaid categories.
const DEFAULT_LEAVE_TYPES = [
  { code: "ANNUAL",       name: "Annual leave",          paid: true,  max_days_per_year: 14 },
  { code: "SICK",         name: "Sick leave",            paid: true,  max_days_per_year: 6 },
  { code: "BEREAVEMENT",  name: "Bereavement leave",     paid: true,  max_days_per_year: 3 },
  { code: "COMPASSIONATE", name: "Compassionate leave",  paid: true,  max_days_per_year: 3 },
  { code: "MATERNITY",    name: "Maternity leave",       paid: false, max_days_per_year: null },
  { code: "UNPAID",       name: "Unpaid leave",          paid: false, max_days_per_year: null },
  { code: "LATE",          name: "Late",                  paid: true,  max_days_per_year: null },
  { code: "ABSENT_UNAUTH", name: "Absent (unauthorised)", paid: false, max_days_per_year: null },
];

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

    // For each company, derive the next pay-period window from the most recent
    // pay_period. Fallback: today-13 → today.
    const lastPeriods = await dbi.collection("pay_periods").aggregate([
      { $match: { company_id: { $in: companyIds } } },
      { $sort: { period_end: -1 } },
      { $group: { _id: "$company_id", period_end: { $first: "$period_end" } } },
    ]).toArray();
    const lastEnd: Record<string, string> = {};
    for (const r of lastPeriods) lastEnd[r._id.toString()] = r.period_end;

    const nextWindow = (companyId: string): { start: string; end: string; days: string[] } => {
      const last = lastEnd[companyId];
      let start: Date, end: Date;
      if (last) {
        // start = last period_end + 1 day
        start = new Date(last + "T00:00:00Z");
        start.setUTCDate(start.getUTCDate() + 1);
        end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 13);
      } else {
        end = new Date();
        end.setUTCHours(0, 0, 0, 0);
        start = new Date(end);
        start.setUTCDate(start.getUTCDate() - 13);
      }
      const days: string[] = [];
      const cur = new Date(start);
      while (cur <= end) {
        days.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return { start: days[0], end: days[days.length - 1], days };
    };

    return NextResponse.json({
      teams: divisions.map((d: any) => {
        const company = cMap[d.company_id.toString()] || {};
        const win = nextWindow(d.company_id.toString());
        return {
          company_id: d.company_id.toString(),
          company_name: company.name || "",
          company_currency: company.currency || "PGK",
          leave_types: Array.isArray(company.leave_types) ? company.leave_types : DEFAULT_LEAVE_TYPES,
          division_id: d._id.toString(),
          division_name: d.name,
          default_hours: d.default_hours ?? 80,
          timesheet_mode: !!d.timesheet_mode,
          period_start: win.start, period_end: win.end, period_days: win.days,
          employees: (byDivision[d._id.toString()] || []).map((e: any) => {
            // Post-consumption resubmission flag — true when this employee's most
            // recent pay period covers the current submission window. The supervisor's
            // next save is for a *future* period; the UI surfaces a red banner so
            // they know the prior period was already paid and changes don't
            // back-apply.
            const post_consumption = !!(e.last_consumed_period_end
              && String(e.last_consumed_period_end) >= win.end);
            return {
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
              pending_timesheet: e.pending_timesheet || null,
              last_consumed_period_end: e.last_consumed_period_end || null,
              last_consumed_at: e.last_consumed_at || null,
              post_consumption,
              submission_history: Array.isArray(e.submission_history)
                ? e.submission_history.slice(-5).map((s: any) => ({
                    ts: s.ts, by_email: s.by_email,
                    total_hours: s.total_hours, post_consumption: !!s.post_consumption,
                  }))
                : [],
            };
          }),
        };
      }),
    });
  } catch (e: any) {
    console.error("[teebeepay/supervisor/team] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
