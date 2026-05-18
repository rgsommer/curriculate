// Daily supervisor-hours reminder. Runs each morning. For each company that
// has set an `hours_due_day` (0=Sun..6=Sat) and `hours_due_time`, if today
// matches that day-of-week, email every division supervisor (where
// supervisor_submits_hours=true) who hasn't yet saved hours since the last
// scheduled deadline. The email includes a one-click link to /teebeepay/app
// (the supervisor signs in normally and lands on "My team").
//
// Vercel Cron hits this with Authorization: Bearer <CRON_SECRET>.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "../../_auth";
import { logAudit } from "../../_audit";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeebeePay <noreply@curriculate.net>";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://www.curriculate.net").replace(/\/+$/, "");
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev fallback
  const hdr = req.headers.get("authorization") || "";
  return hdr === `Bearer ${secret}`;
}

function esc(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (c: string) => ({ "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'":"&#39;" }[c] as string));
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // PG time is UTC+10, no DST. Use PG-day-of-week consistently.
  const now = new Date();
  const pgNow = new Date(now.getTime() + 10 * 60 * 60 * 1000);
  const todayDow = pgNow.getUTCDay();   // 0=Sun..6=Sat
  const pgIso = pgNow.toISOString().slice(0, 10);

  try {
    const dbi = await db();
    const companies: any[] = await dbi.collection("companies").find({
      $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
      hours_due_day: todayDow,
    }).toArray();
    if (!companies.length) {
      return NextResponse.json({ ok: true, message: "No companies due today.", date: pgIso });
    }

    let emailsSent = 0, supervisorsConsidered = 0, supervisorsAlreadyDone = 0;
    for (const co of companies) {
      const cid = co._id;
      const divisions: any[] = await dbi.collection("divisions").find({
        company_id: cid, supervisor_submits_hours: true,
        supervisor_employee_id: { $exists: true, $ne: null },
        $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
      }).toArray();
      if (!divisions.length) continue;

      const supIds = Array.from(new Set(divisions.map((d) => d.supervisor_employee_id.toString())))
        .map((s) => new (require("mongodb").ObjectId)(s));
      const supervisors: any[] = await dbi.collection("employees")
        .find({ _id: { $in: supIds } }).toArray();
      const supMap = Object.fromEntries(supervisors.map((s: any) => [s._id.toString(), s]));

      // Group divisions by supervisor email
      const bySup: Record<string, { sup: any; divs: any[] }> = {};
      for (const d of divisions) {
        const s = supMap[d.supervisor_employee_id.toString()];
        if (!s || !s.email) continue;
        const key = String(s.email).toLowerCase();
        if (!bySup[key]) bySup[key] = { sup: s, divs: [] };
        bySup[key].divs.push(d);
      }

      for (const { sup, divs } of Object.values(bySup)) {
        supervisorsConsidered++;

        // Have they submitted? Check if every employee in their divisions has
        // pending_hours_at set with a value from after the *previous* scheduled
        // deadline. Simpler heuristic: if EVERY team employee has pending_hours_at
        // within the last 6 days, treat them as done.
        const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        const emps: any[] = await dbi.collection("employees").find({
          company_id: cid,
          division_id: { $in: divs.map((d) => d._id) },
          $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
        }).toArray();
        if (!emps.length) continue;

        const allDone = emps.every((e: any) => e.pending_hours_at && new Date(e.pending_hours_at) >= sixDaysAgo);
        if (allDone) { supervisorsAlreadyDone++; continue; }

        const link = `${PUBLIC_URL}/teebeepay/app?next=my_team`;
        const subject = `Reminder — please submit ${co.name} team hours by ${co.hours_due_time || "EOD"}`;
        const divList = divs.map((d) => `<li>${esc(d.name)} (${emps.filter((e: any) => e.division_id.toString() === d._id.toString()).length} employee(s))</li>`).join("");
        const html = `
          <p>Hi ${esc((sup.first_name || sup.email || "").trim())},</p>
          <p>${esc(co.name)}'s pay run is scheduled and your team's hours are due by
            <strong>${esc(co.hours_due_time || "end of day")}</strong> today.</p>
          <p>Divisions you supervise:</p>
          <ul style="margin:0 0 14px 18px">${divList}</ul>
          <p style="margin:18px 0">
            <a href="${link}" style="display:inline-block;padding:12px 22px;background:#b9302a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
              Open My team's hours →
            </a>
          </p>
          <p style="color:#666;font-size:12px;margin-top:24px">
            Sent automatically by TeebeePay. Set or change this deadline on the
            <strong>${esc(co.name)} → Settings</strong> tab.
          </p>
        `;
        try {
          if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
            await resend.emails.send({ from: FROM, to: sup.email, subject, html });
            emailsSent++;
          }
        } catch (e) {
          console.warn("[hours-due-reminders] send failed for", sup.email, e);
        }
      }
    }

    await logAudit({
      actor_email: "cron", actor_kind: "system",
      action: "cron.hours_due_reminders",
      resource_type: "system", resource_id: pgIso,
      details: { companies_due: companies.length, emails_sent: emailsSent,
                  supervisors_considered: supervisorsConsidered,
                  supervisors_already_done: supervisorsAlreadyDone },
    });

    return NextResponse.json({
      ok: true, date: pgIso, companiesDue: companies.length,
      emailsSent, supervisorsConsidered, supervisorsAlreadyDone,
    });
  } catch (e: any) {
    console.error("[cron/hours-due-reminders] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
