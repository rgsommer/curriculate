// GET pay period + entries.  PATCH supports editing period_notes.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";
import { logAudit } from "../../_audit";

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

// PATCH — currently supports period_notes only. Bookkeeper+ on their own
// company; principal/system-owner across companies.
export async function PATCH(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { pid } = await params;
  const b = await req.json().catch(() => ({} as any));
  try {
    const dbi = await db();
    const p: any = await dbi.collection("pay_periods").findOne({ _id: new ObjectId(pid) });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (u.clearance < 3 && u.company_id !== p.company_id.toString()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const $set: any = { updated_at: new Date() };
    if ("period_notes" in b) {
      $set.period_notes = String(b.period_notes || "").slice(0, 4000);
      $set.period_notes_by = u.email;
      $set.period_notes_at = new Date();
    }
    if (Object.keys($set).length <= 1) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    await dbi.collection("pay_periods").updateOne({ _id: p._id }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
