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

    function hoursFromClock(inStr: string, outStr: string): number {
      // HH:MM minus HH:MM, never negative. Same-day only (no overnight handling yet).
      const m = (s: string) => {
        const [h, mm] = String(s || "").split(":").map(Number);
        return (h * 60) + (mm || 0);
      };
      if (!inStr || !outStr) return 0;
      const diff = (m(outStr) - m(inStr)) / 60;
      return diff > 0 ? Math.round(diff * 100) / 100 : 0;
    }
    function totalFromTimesheet(ts: any): number {
      if (!ts || typeof ts !== "object") return 0;
      let sum = 0;
      for (const k of Object.keys(ts)) {
        const day = ts[k];
        if (!day) continue;
        if (day.hours != null && day.hours !== "") {
          sum += Number(day.hours) || 0;
        } else if (day.clock_in && day.clock_out) {
          sum += hoursFromClock(day.clock_in, day.clock_out);
        }
      }
      return Math.round(sum * 100) / 100;
    }

    let saved = 0, skipped = 0;
    for (const r of rows) {
      if (!r.employee_id) { skipped++; continue; }
      const emp: any = await dbi.collection("employees").findOne({ _id: new ObjectId(String(r.employee_id)) });
      if (!emp || !emp.division_id) { skipped++; continue; }
      if (!allowedDivIds.has(emp.division_id.toString())) { skipped++; continue; }

      const cash_advance = Math.max(0, Number(r.cash_advance) || 0);
      const note = String(r.note || "").slice(0, 1000);
      const $set: any = {
        pending_cash_advance: cash_advance,
        pending_note: note,
        pending_hours_by: u.email,
        pending_hours_at: new Date(),
      };

      if (r.timesheet && typeof r.timesheet === "object") {
        // Timesheet mode: persist daily map and derive total hours from it.
        // Sanitise: only keep keys that look like ISO dates (YYYY-MM-DD).
        const clean: Record<string, any> = {};
        for (const k of Object.keys(r.timesheet)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
          const v = r.timesheet[k] || {};
          clean[k] = {
            hours: v.hours != null && v.hours !== "" ? Number(v.hours) : null,
            clock_in: v.clock_in ? String(v.clock_in).slice(0, 5) : null,
            clock_out: v.clock_out ? String(v.clock_out).slice(0, 5) : null,
            note: v.note ? String(v.note).slice(0, 200) : "",
            leave_type: v.leave_type ? String(v.leave_type).slice(0, 32) : null,
          };
        }
        $set.pending_timesheet = clean;
        $set.pending_hours = totalFromTimesheet(clean);
      } else {
        // Period mode: a single hours total.
        $set.pending_hours = Math.max(0, Number(r.hours) || 0);
        $set.pending_timesheet = null;
      }

      await dbi.collection("employees").updateOne({ _id: emp._id }, { $set });
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
