// POST  → create a new draft pay period with entries.
// Body  : { period_start, period_end, pay_date, entries: [{ employee_id, hours, cash_advance, note }] }
// Status: 'pending_approval'  (approval later via /payroll-periods/[pid]/approve)
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";
import { calculate } from "../../../_payroll";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 1) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  if (!b.period_start || !b.period_end || !b.pay_date) {
    return NextResponse.json({ error: "period_start, period_end and pay_date are required." }, { status: 400 });
  }
  const entries = Array.isArray(b.entries) ? b.entries : [];

  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const company: any = await dbi.collection("companies").findOne({ _id: cid });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    // Active rules for this company
    const ruleRow: any[] = await dbi.collection("tax_rules")
      .find({ company_id: cid }).sort({ effective_from: -1, _id: -1 }).limit(1).toArray();
    const rules = ruleRow.length ? (typeof ruleRow[0].data === "string" ? JSON.parse(ruleRow[0].data) : ruleRow[0].data) : {};

    const periodRes = await dbi.collection("pay_periods").insertOne({
      company_id: cid,
      period_start: b.period_start,
      period_end: b.period_end,
      pay_date: b.pay_date,
      status: "pending_approval",
      created_by: u.uid,
      created_at: new Date(),
      submitted_at: new Date(),
    });
    const periodId = periodRes.insertedId;

    let inserted = 0;
    for (const e of entries) {
      if (!e.employee_id) continue;
      const emp: any = await dbi.collection("employees").findOne({ _id: new ObjectId(e.employee_id) });
      if (!emp || emp.company_id.toString() !== id) continue;

      const hours = parseFloat(e.hours || "0") || 0;
      const cash_advance = parseFloat(e.cash_advance || "0") || 0;
      const note = (e.note || "").slice(0, 1000);
      const calc = calculate(emp, { hours, cash_advance }, rules, company);

      await dbi.collection("payroll_entries").insertOne({
        pay_period_id: periodId,
        employee_id: emp._id,
        hours, cash_advance, note,
        gross: calc.gross, tax: calc.tax, nasfund: calc.nasfund,
        other_deductions: calc.other_deductions, net: calc.net,
        calc_breakdown: calc.breakdown,
      });
      inserted++;
    }

    return NextResponse.json({ ok: true, id: periodId.toString(), entries: inserted });
  } catch (e: any) {
    console.error("[teebeepay/payroll-periods POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
