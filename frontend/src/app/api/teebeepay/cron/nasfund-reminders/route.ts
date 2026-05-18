// frontend/src/app/api/teebeepay/cron/nasfund-reminders/route.ts
//
// Daily NASFund-deadline reminder. Runs once a day at 08:00 PG time
// (see vercel.json schedule). For each company with an ncsl_employer_no
// and a manager_email or office_email, if today's date is exactly 5 days
// before the next 21st-of-month, send a reminder email.
//
// Vercel Cron Jobs hit this endpoint with an Authorization: Bearer
// <CRON_SECRET> header. The route rejects requests without it.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "../../_auth";
import { logAudit } from "../../_audit";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeebeePay <noreply@curriculate.net>";
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev fallback
  const hdr = req.headers.get("authorization") || "";
  return hdr === `Bearer ${secret}`;
}

// Returns the next 21st-of-the-month (inclusive of today if today is the 21st)
function nextDeadline(today: Date): Date {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 21));
  if (today.getUTCDate() > 21) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function esc(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (c: string) => ({ "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'":"&#39;" }[c] as string));
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const deadline = nextDeadline(today);
  const daysOut = daysBetween(today, deadline);

  // Send reminders at exactly 5 days out (final) and 14 days out (early heads-up).
  const shouldRemind = daysOut === 5 || daysOut === 14;
  if (!shouldRemind) {
    return NextResponse.json({ ok: true, message: `No reminder day. Days to next 21st: ${daysOut}`, daysOut });
  }

  try {
    const dbi = await db();
    const companies: any[] = await dbi.collection("companies")
      .find({ is_active: { $ne: 0 }, ncsl_employer_no: { $exists: true, $ne: null } }).toArray();

    const monthLabel = deadline.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const dueYmd = deadline.toISOString().slice(0, 10);

    let sent = 0, skipped = 0, failed = 0;
    for (const c of companies) {
      const to = (c.manager_email || c.office_email || "").trim().toLowerCase();
      if (!to) { skipped++; continue; }
      const urgency = daysOut === 5 ? "is due in 5 days" : "is due in 2 weeks";
      const subject = `NASFund return ${urgency} — ${c.name} (due ${dueYmd})`;
      const html = `
        <p>This is a TeebeePay reminder that <strong>${esc(c.name)}</strong>'s
           NASFund contribution return ${urgency} — the next deadline is
           <strong>${dueYmd}</strong> (${esc(monthLabel)} contributions).</p>
        <p>Your NASFund employer number on file: <code>${esc(c.ncsl_employer_no)}</code></p>
        <ul style="line-height:1.7">
          <li>Sign in to TeebeePay, open <strong>${esc(c.name)} → Pay periods</strong> for
              the current month, and download <strong>NASFund return XLSX</strong>.</li>
          <li>The return is auto-signed with your AP signature if you've uploaded one.</li>
          <li>Submit via Nasfund's portal or by email per the schedule.</li>
        </ul>
        <p>Penalty for late remittance is 2% of the unpaid balance per month — easy to avoid.</p>
        <p style="margin-top:18px"><a href="https://www.curriculate.net/teebeepay/app" style="display:inline-block;padding:10px 18px;background:#b9302a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open TeebeePay →</a></p>
        <p style="color:#888;font-size:12px;margin-top:24px">This is an automated reminder from TeebeePay. To stop receiving them, clear the company's manager email in Settings.</p>
      `;
      try {
        if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
          await resend.emails.send({ from: FROM, to, subject, html });
        }
        sent++;
        await logAudit({
          actor_email: null, actor_kind: "cron",
          action: "nasfund.reminder_sent",
          company_id: c._id.toString(),
          details: { to, daysOut, deadline: dueYmd },
        });
      } catch (e) {
        console.error("[cron/nasfund] send failed:", c._id, e);
        failed++;
      }
    }

    return NextResponse.json({ ok: true, daysOut, deadline: dueYmd, sent, skipped, failed });
  } catch (e: any) {
    console.error("[cron/nasfund] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
