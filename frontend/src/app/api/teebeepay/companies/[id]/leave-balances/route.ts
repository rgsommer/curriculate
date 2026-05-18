// GET → per-employee leave usage for the current (or specified) calendar year.
//   ?year=YYYY (default = current year)
//
// Returns:
//   leave_types — the company's configured leave types (with max_days_per_year)
//   rows        — one row per employee: { id, name, [code]: days_used, total_paid_days, total_unpaid_days }
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const company: any = await dbi.collection("companies").findOne({ _id: cid });
    const leaveTypes = Array.isArray(company?.leave_types) && company.leave_types.length
      ? company.leave_types : DEFAULT_LEAVE_TYPES;
    const ltByCode: Record<string, any> = Object.fromEntries(leaveTypes.map((l: any) => [l.code, l]));

    const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
    // Aggregate days per (employee, leave_type) for the year
    const rows = await dbi.collection("leave_records").aggregate([
      { $match: { company_id: cid, date: { $gte: yearStart, $lte: yearEnd } } },
      { $group: { _id: { eid: "$employee_id", code: "$leave_type" }, days: { $sum: 1 } } },
    ]).toArray();

    // Employee list (active or has rows)
    const empIds = Array.from(new Set(rows.map((r: any) => r._id.eid.toString())));
    const employees: any[] = await dbi.collection("employees").find({
      company_id: cid,
      $or: [{ _id: { $in: empIds.map((s) => new ObjectId(s)) } }, { is_active: 1 }],
    }).toArray();

    const empMap: Record<string, any> = {};
    for (const e of employees) {
      empMap[e._id.toString()] = {
        id: e._id.toString(),
        name: `${e.last_name || ""}, ${e.first_name || ""}`.trim().replace(/^,\s*/, ""),
        active: e.is_active !== 0,
        usage: {} as Record<string, number>,
      };
    }
    for (const r of rows) {
      const eid = r._id.eid.toString();
      if (!empMap[eid]) continue;
      empMap[eid].usage[r._id.code] = r.days;
    }
    const out = Object.values(empMap).map((emp: any) => {
      let paid = 0, unpaid = 0;
      for (const code of Object.keys(emp.usage)) {
        const lt = ltByCode[code];
        const days = emp.usage[code];
        if (lt?.paid) paid += days; else unpaid += days;
      }
      return { ...emp, total_paid_days: paid, total_unpaid_days: unpaid };
    }).sort((a: any, b: any) => a.name.localeCompare(b.name));

    return NextResponse.json({
      year, leave_types: leaveTypes, rows: out,
    });
  } catch (e: any) {
    console.error("[teebeepay/leave-balances] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
