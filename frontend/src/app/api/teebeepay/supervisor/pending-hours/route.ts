// POST { entries: [{ employee_id, hours, cash_advance?, note? }] }
//
// Supervisor saves "pending hours" for their team. These sit on the employee
// record and get auto-consumed by the next payroll-period POST.
//
// Authorization: each employee in the body must belong to a division the
// caller supervises (matched via employee.email = u.email → division
// .supervisor_employee_id) AND division.supervisor_submits_hours = true.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";
import { logAudit } from "../../_audit";

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const rows: any[] = Array.isArray(b.entries) ? b.entries : [];
  if (!rows.length) return NextResponse.json({ error: "No entries provided." }, { status: 400 });

  try {
    const dbi = await db();
    // Determine which divisions the caller supervises (submits-hours = true)
    const myEmployees: any[] = await dbi.collection("employees")
      .find({ email: u.email }).toArray();
    if (!myEmployees.length) return NextResponse.json({ error: "You don't supervise any divisions." }, { status: 403 });
    const myIds = myEmployees.map((e) => e._id);
    const divisions: any[] = await dbi.collection("divisions").find({
      supervisor_employee_id: { $in: myIds },
      supervisor_submits_hours: true,
    }).toArray();
    if (!divisions.length) return NextResponse.json({ error: "You don't supervise any divisions." }, { status: 403 });
    const allowedDivIds = new Set(divisions.map((d) => d._id.toString()));

    let saved = 0, skipped = 0;
    for (const r of rows) {
      if (!r.employee_id) { skipped++; continue; }
      const emp: any = await dbi.collection("employees").findOne({ _id: new ObjectId(String(r.employee_id)) });
      if (!emp || !emp.division_id) { skipped++; continue; }
      if (!allowedDivIds.has(emp.division_id.toString())) { skipped++; continue; }

      const hours = Math.max(0, Number(r.hours) || 0);
      const cash_advance = Math.max(0, Number(r.cash_advance) || 0);
      const note = String(r.note || "").slice(0, 1000);
      await dbi.collection("employees").updateOne({ _id: emp._id }, {
        $set: {
          pending_hours: hours,
          pending_cash_advance: cash_advance,
          pending_note: note,
          pending_hours_by: u.email,
          pending_hours_at: new Date(),
        },
      });
      saved++;
    }

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "supervisor.hours_submit",
      resource_type: "user", resource_id: u.uid,
      details: { saved, skipped },
    });

    return NextResponse.json({ ok: true, saved, skipped });
  } catch (e: any) {
    console.error("[teebeepay/supervisor/pending-hours] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
