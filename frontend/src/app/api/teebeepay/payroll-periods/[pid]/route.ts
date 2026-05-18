// GET pay period + entries.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pid } = await params;
  try {
    const dbi = await db();
    const p: any = await dbi.collection("pay_periods").findOne({ _id: new ObjectId(pid) });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (u.clearance < 3 && u.company_id !== p.company_id.toString()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const entries: any[] = await dbi.collection("payroll_entries").find({ pay_period_id: p._id }).toArray();
    const empIds = entries.map((e) => e.employee_id);
    const emps: any[] = await dbi.collection("employees").find({ _id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map((e) => [e._id.toString(), e]));
    return NextResponse.json({
      period: { ...p, id: p._id.toString(), company_id: p.company_id.toString(), _id: undefined },
      entries: entries.map((e: any) => {
        const emp = empMap[e.employee_id.toString()] || {};
        return {
          id: e._id.toString(),
          employee_id: e.employee_id.toString(),
          employee_name: `${emp.last_name || ""}, ${emp.first_name || ""}`,
          employee_email: emp.email || null,
          hours: e.hours, cash_advance: e.cash_advance, note: e.note,
          gross: e.gross, tax: e.tax, nasfund: e.nasfund,
          other_deductions: e.other_deductions, net: e.net,
        };
      }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
