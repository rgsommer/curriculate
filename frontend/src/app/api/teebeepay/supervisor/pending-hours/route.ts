// POST { entries: [{ employee_id, hours | timesheet, cash_advance?, note? }] }
//
// Supervisor saves "pending hours" for their team. These sit on the employee
// record and get auto-consumed by the next payroll-period POST.
//
// Side effects per save:
//   - submission_history[] gets a new entry on each employee record
//   - if the employee's last_consumed_period_end ≥ supervisor's window end,
//     the save is flagged post_consumption (UI shows red banner; data still
//     queues for the NEXT period — no auto back-application)
//   - any day with leave_type ∈ {LATE, ABSENT_UNAUTH} creates an
//     attendance_incidents row (idempotent on {employee_id,date,kind})
//   - if the rolling incident count in the company's late_window_days exceeds
//     late_threshold_count, an alert email is sent to the configured recipients
//     (Principal / Supervisor / Bookkeeper) and the employee is stamped
//     last_late_alert_at to suppress repeats inside the same window.
//
// Authorization: each employee in the body must belong to a division the
// caller supervises (matched via employee.email = u.email → division
// .supervisor_employee_id) AND division.supervisor_submits_hours = true.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId } from "../../_auth";
import { logAudit } from "../../_audit";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeebeePay <noreply@curriculate.net>";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://www.curriculate.net").replace(/\/+$/, "");
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");

const INCIDENT_KINDS = new Set(["LATE", "ABSENT_UNAUTH"]);

function esc(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (c: string) => ({ "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'":"&#39;" }[c] as string));
}

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
    const divisionById = Object.fromEntries(divisions.map((d) => [d._id.toString(), d]));

    function hoursFromClock(inStr: string, outStr: string): number {
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

    let saved = 0, skipped = 0, postConsumptionFlagged = 0;
    let alertsSent = 0;
    const incidentsCreated: any[] = [];

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

      let timesheetClean: Record<string, any> | null = null;
      let totalHours = 0;
      if (r.timesheet && typeof r.timesheet === "object") {
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
        timesheetClean = clean;
        totalHours = totalFromTimesheet(clean);
        $set.pending_timesheet = clean;
        $set.pending_hours = totalHours;
      } else {
        totalHours = Math.max(0, Number(r.hours) || 0);
        $set.pending_hours = totalHours;
        $set.pending_timesheet = null;
      }

      // Post-consumption detection: did the bookkeeper already cut a period that
      // covers (or extends past) what we think the supervisor's current window is?
      // We use the supervisor-provided latest date in timesheet (or today as a
      // fallback) as the implicit window-end.
      const dates = timesheetClean ? Object.keys(timesheetClean).sort() : [];
      const windowEnd = dates.length ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);
      const postConsumption = !!(emp.last_consumed_period_end
        && String(emp.last_consumed_period_end) >= windowEnd);
      if (postConsumption) postConsumptionFlagged++;

      // Append to submission_history (keep last 50 entries).
      const historyEntry = {
        ts: new Date(),
        by_email: u.email,
        total_hours: totalHours,
        cash_advance,
        note,
        timesheet: timesheetClean,
        post_consumption: postConsumption,
        prior_total: emp.pending_hours ?? null,
      };
      const newHistory = [...(emp.submission_history || []), historyEntry].slice(-50);
      $set.submission_history = newHistory;
      $set.post_consumption_flag = postConsumption ? true : false;

      await dbi.collection("employees").updateOne({ _id: emp._id }, { $set });
      saved++;

      // Attendance incidents — only when in timesheet mode (no daily granularity in period mode)
      if (timesheetClean) {
        for (const dateStr of Object.keys(timesheetClean)) {
          const day = timesheetClean[dateStr];
          const kind = day.leave_type;
          if (!kind || !INCIDENT_KINDS.has(kind)) continue;
          // Upsert by {employee_id, date, kind} so re-saving a fortnight doesn't double-count.
          const upsert = await dbi.collection("attendance_incidents").updateOne(
            { employee_id: emp._id, date: dateStr, kind },
            {
              $setOnInsert: {
                employee_id: emp._id,
                company_id: emp.company_id,
                division_id: emp.division_id,
                date: dateStr,
                kind,
                logged_at: new Date(),
                logged_by: u.email,
                note: day.note || null,
              },
            },
            { upsert: true },
          );
          if (upsert.upsertedCount) incidentsCreated.push({ employee_id: emp._id.toString(), date: dateStr, kind });
        }

        // After persisting incidents, run the threshold check for this employee.
        const company: any = await dbi.collection("companies").findOne({ _id: emp.company_id });
        const threshold = Number(company?.late_threshold_count);
        const windowDays = Math.max(1, Number(company?.late_window_days || 30));
        if (Number.isFinite(threshold) && threshold > 0) {
          const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
          // Use date string compare (incidents store ISO date strings)
          const sinceStr = since.toISOString().slice(0, 10);
          const incidents: any[] = await dbi.collection("attendance_incidents").find({
            employee_id: emp._id, date: { $gte: sinceStr },
          }).sort({ date: 1 }).toArray();

          // Suppress repeated alerts within the window: only fire if this employee
          // hasn't been alerted since the oldest qualifying incident's date.
          const earliestIncidentDate = incidents.length ? incidents[0].date : null;
          const lastAlert = emp.last_late_alert_at ? new Date(emp.last_late_alert_at) : null;
          const lastAlertOk = !lastAlert || (earliestIncidentDate && lastAlert < new Date(earliestIncidentDate));

          if (incidents.length >= threshold && lastAlertOk) {
            // Build recipient email list from late_alert_recipients ∈ { principal, supervisor, bookkeeper }
            const recips: string[] = [];
            const recipKinds: string[] = Array.isArray(company?.late_alert_recipients)
              ? company.late_alert_recipients : ["supervisor"];

            if (recipKinds.includes("supervisor")) {
              const sup = divisionById[emp.division_id.toString()];
              if (sup?.supervisor_employee_id) {
                const supEmp: any = await dbi.collection("employees").findOne({ _id: sup.supervisor_employee_id });
                if (supEmp?.email) recips.push(supEmp.email);
              }
            }
            if (recipKinds.includes("principal") || recipKinds.includes("bookkeeper")) {
              // Pull every active user whose role matches (system-wide principal/owner is included)
              const userRoles: string[] = [];
              if (recipKinds.includes("principal")) userRoles.push("principal", "system_owner");
              if (recipKinds.includes("bookkeeper")) userRoles.push("bookkeeper");
              const users: any[] = await dbi.collection("users").find({
                role: { $in: userRoles },
                $or: [
                  { company_id: emp.company_id },
                  { company_id: null },
                  { company_id: { $exists: false } },
                ],
                $and: [{ $or: [{ is_active: 1 }, { is_active: { $exists: false } }] }],
              }).toArray();
              for (const us of users) if (us.email) recips.push(us.email);
            }

            const unique = Array.from(new Set(recips.map((x) => x.toLowerCase())));
            if (unique.length && (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY)) {
              const recentList = incidents.slice(-threshold).reverse()
                .map((i: any) => `<li>${esc(i.date)} — <strong>${esc(i.kind === "LATE" ? "Late" : "Absent (unauthorised)")}</strong>${i.note ? ` · ${esc(i.note)}` : ""}</li>`)
                .join("");
              const empFull = `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.email || "Employee";
              const link = `${PUBLIC_URL}/teebeepay/app`;
              const subject = `Attendance alert — ${empFull} late ${incidents.length}× in ${windowDays} days`;
              const html = `
                <p><strong>${esc(empFull)}</strong> at <strong>${esc(company?.name || "")}</strong> has been recorded
                  <strong>${incidents.length}</strong> time${incidents.length === 1 ? "" : "s"} in the last
                  ${windowDays} day${windowDays === 1 ? "" : "s"} (threshold: ${threshold}).</p>
                <p>Recent incidents:</p>
                <ul style="margin:0 0 14px 18px">${recentList}</ul>
                <p style="margin:18px 0">
                  <a href="${link}" style="display:inline-block;padding:10px 18px;background:#b9302a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
                    Open TeebeePay →
                  </a>
                </p>
                <p style="color:#666;font-size:12px;margin-top:24px">
                  Configure the threshold or recipients on <strong>${esc(company?.name || "")} → Settings → Late-attendance alerts</strong>.
                </p>
              `;
              try {
                await resend.emails.send({ from: FROM, to: unique, subject, html });
                alertsSent++;
                await dbi.collection("employees").updateOne({ _id: emp._id }, {
                  $set: { last_late_alert_at: new Date(), last_late_alert_count: incidents.length },
                });
              } catch (e) {
                console.warn("[supervisor/pending-hours] alert send failed:", e);
              }
            }
          }
        }
      }
    }

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "supervisor.hours_submit",
      resource_type: "user", resource_id: u.uid,
      details: { saved, skipped, post_consumption: postConsumptionFlagged,
                  attendance_incidents_created: incidentsCreated.length,
                  alerts_sent: alertsSent },
    });

    return NextResponse.json({
      ok: true, saved, skipped,
      post_consumption: postConsumptionFlagged,
      attendance_incidents_created: incidentsCreated.length,
      alerts_sent: alertsSent,
    });
  } catch (e: any) {
    console.error("[teebeepay/supervisor/pending-hours] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
