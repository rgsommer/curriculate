// POST { kind: "percent"|"fixed", value: number, direction: "increase"|"decrease",
//        reason: string, effective_date?: "YYYY-MM-DD" }
//
// Principal-only. Applies the adjustment to either hourly_rate (for hourly
// employees) or annual_salary (for salaried), writes an audit log entry with
// the old/new values and the reason, and stores the change on the employee's
// `pay_history` array.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../../_auth";
import { logAudit } from "../../../../../_audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; eid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Pay adjustments require principal clearance." }, { status: 403 });
  const { id, eid } = await params;
  const b = await req.json().catch(() => ({} as any));

  const kind = b.kind === "fixed" ? "fixed" : "percent";
  const direction = b.direction === "decrease" ? "decrease" : "increase";
  const value = Number(b.value);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Value must be a positive number." }, { status: 400 });
  }
  const reason = String(b.reason || "").trim().slice(0, 500);
  if (!reason) return NextResponse.json({ error: "Reason is required for the audit log." }, { status: 400 });
  const effective_date = (b.effective_date && /^\d{4}-\d{2}-\d{2}$/.test(b.effective_date))
    ? b.effective_date
    : new Date().toISOString().slice(0, 10);

  try {
    const dbi = await db();
    const emp: any = await dbi.collection("employees").findOne({
      _id: new ObjectId(eid), company_id: new ObjectId(id),
    });
    if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

    const isHourly = emp.pay_type === "hourly";
    const fieldKey: "hourly_rate" | "annual_salary" = isHourly ? "hourly_rate" : "annual_salary";
    const oldVal = Number(emp[fieldKey] || 0);
    if (oldVal <= 0) {
      return NextResponse.json({
        error: `Cannot adjust ${fieldKey}: current value is zero or unset. Edit the employee first.`,
      }, { status: 400 });
    }

    const delta = kind === "percent" ? oldVal * (value / 100) : value;
    const signed = direction === "increase" ? delta : -delta;
    const newVal = Math.max(0, Math.round((oldVal + signed) * 100) / 100);

    const adjustment = {
      ts: new Date(),
      by_email: u.email,
      by_uid: u.uid,
      pay_field: fieldKey,
      kind,                 // percent | fixed
      direction,
      value,                // the raw % or PGK amount
      old_value: oldVal,
      new_value: newVal,
      delta: Math.round(signed * 100) / 100,
      reason,
      effective_date,
    };

    await dbi.collection("employees").updateOne({ _id: emp._id }, ({
      $set: { [fieldKey]: newVal, updated_at: new Date() },
      $push: { pay_history: adjustment },
    } as any));

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "employee.pay_adjust",
      resource_type: "employee", resource_id: eid,
      company_id: id,
      details: {
        employee_name: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
        ...adjustment,
        ts: adjustment.ts.toISOString(),
      },
    });

    return NextResponse.json({ ok: true, adjustment, new_value: newVal });
  } catch (e: any) {
    console.error("[teebeepay/adjust-pay] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
