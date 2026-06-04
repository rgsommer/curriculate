// POST  → create a new draft pay period with entries.
// Body  : { period_start, period_end, pay_date, entries: [{ employee_id, hours, cash_advance, note }] }
// Status: 'pending_approval'  (approval later via /payroll-periods/[pid]/approve)
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId, makeApprovalToken } from "../../../_auth";
import { calculate } from "../../../_payroll";
import { logAudit } from "../../../_audit";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeebeePay <noreply@curriculate.net>";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://www.curriculate.net").replace(/\/+$/, "");
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");
function esc(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (c: string) => ({ "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'":"&#39;" }[c] as string));
}

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

    // De-dupe: the caller may also send entries for supervisor-managed employees
    // (e.g. higher-clearance bookkeepers who can see everyone). We treat
    // caller-provided values as canonical and only use pending_hours for
    // employees not in the body.
    const submittedEmpIds = new Set<string>(
      entries.filter((e: any) => e.employee_id).map((e: any) => String(e.employee_id))
    );

    let inserted = 0;
    const insertEntry = async (emp: any, hours: number, cash_advance: number, note: string,
                                source: "site_payroll" | "supervisor_pending", final_pay = false) => {
      const calc = calculate(emp, { hours, cash_advance, final_pay }, rules, company);
      await dbi.collection("payroll_entries").insertOne({
        pay_period_id: periodId,
        employee_id: emp._id,
        hours, cash_advance, note, final_pay,
        gross: calc.gross, tax: calc.tax, nasfund: calc.nasfund,
        other_deductions: calc.other_deductions, net: calc.net,
        calc_breakdown: calc.breakdown,
        source,
      });
      inserted++;
    };

    for (const e of entries) {
      if (!e.employee_id) continue;
      const emp: any = await dbi.collection("employees").findOne({ _id: new ObjectId(e.employee_id) });
      if (!emp || emp.company_id.toString() !== id) continue;

      const hours = parseFloat(e.hours || "0") || 0;
      const cash_advance = parseFloat(e.cash_advance || "0") || 0;
      const note = (e.note || "").slice(0, 1000);
      await insertEntry(emp, hours, cash_advance, note, "site_payroll", !!e.final_pay);
    }

    // Pull in supervisor-managed employees' pending_hours.
    const divisions: any[] = await dbi.collection("divisions").find({
      company_id: cid, supervisor_submits_hours: true,
    }).toArray();
    if (divisions.length) {
      const divIds = divisions.map((d: any) => d._id);
      const supervised: any[] = await dbi.collection("employees").find({
        company_id: cid,
        division_id: { $in: divIds },
        $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
      }).toArray();
      const consumed: any[] = [];
      for (const emp of supervised) {
        if (submittedEmpIds.has(emp._id.toString())) continue;
        const hours = emp.pending_hours != null
          ? Number(emp.pending_hours) || 0
          : Number(emp.default_hours || 80);
        const cash_advance = Number(emp.pending_cash_advance || 0) || 0;
        const note = String(emp.pending_note || "").slice(0, 1000);
        await insertEntry(emp, hours, cash_advance, note, "supervisor_pending");
        consumed.push(emp._id);

        // Persist leave records (one per day with a leave_type) — so the
        // leave-balance report has lifetime history to aggregate.
        const ts = emp.pending_timesheet;
        if (ts && typeof ts === "object") {
          for (const dateStr of Object.keys(ts)) {
            const day = ts[dateStr];
            if (!day?.leave_type) continue;
            await dbi.collection("leave_records").updateOne(
              { employee_id: emp._id, date: dateStr, leave_type: day.leave_type },
              { $set: {
                  employee_id: emp._id, company_id: cid,
                  date: dateStr, leave_type: day.leave_type,
                  hours: day.hours != null ? Number(day.hours) : null,
                  note: day.note || null,
                  pay_period_id: periodId,
                  recorded_at: new Date(),
                } },
              { upsert: true });
          }
        }
      }
      // Clear consumed pending_hours / pending_timesheet so the next period starts fresh.
      // Stamp `last_consumed_period_id` + `last_consumed_period_end` so resubmissions
      // can be detected as post-consumption (and warned about).
      if (consumed.length) {
        await dbi.collection("employees").updateMany(
          { _id: { $in: consumed } },
          {
            $set: {
              last_consumed_period_id: periodId,
              last_consumed_period_end: b.period_end,
              last_consumed_at: new Date(),
            },
            $unset: { pending_hours: "", pending_cash_advance: "", pending_note: "",
                       pending_hours_by: "", pending_hours_at: "", pending_timesheet: "" },
          });
      }
    }

    // Email the company's approver with a magic approval link if we have one.
    let approverEmailedTo: string | null = null;
    try {
      const approverEmail = (company.manager_email || company.office_email || "").trim().toLowerCase();
      if (approverEmail && (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY)) {
        // Recompute totals for the email summary
        const entryDocs: any[] = await dbi.collection("payroll_entries").find({ pay_period_id: periodId }).toArray();
        const totals = entryDocs.reduce((a, e) => ({
          gross: a.gross + (e.gross || 0),
          tax: a.tax + (e.tax || 0),
          nasfund: a.nasfund + (e.nasfund || 0),
          net: a.net + (e.net || 0),
        }), { gross: 0, tax: 0, nasfund: 0, net: 0 });

        const tok = makeApprovalToken(periodId.toString(), approverEmail);
        const link = `${PUBLIC_URL}/teebeepay/approve?t=${encodeURIComponent(tok)}`;
        const ccy = company.currency || "PGK";
        const subject = `Payroll awaiting approval — ${company.name} (${b.period_start} → ${b.period_end})`;
        const html = `
          <p>${esc(company.name)} payroll for <strong>${esc(b.period_start)} to ${esc(b.period_end)}</strong>
             (pay date ${esc(b.pay_date)}) is ready for your approval.</p>
          <table cellpadding="6" style="border-collapse:collapse;font:14px/1.5 -apple-system,Segoe UI,Arial">
            <tr><td><b>Entries</b></td><td align="right">${entryDocs.length}</td></tr>
            <tr><td><b>Total gross</b></td><td align="right">${ccy} ${totals.gross.toFixed(2)}</td></tr>
            <tr><td><b>Total tax</b></td><td align="right">${ccy} ${totals.tax.toFixed(2)}</td></tr>
            <tr><td><b>Total Nasfund</b></td><td align="right">${ccy} ${totals.nasfund.toFixed(2)}</td></tr>
            <tr style="background:#f3f3f3;font-weight:600"><td><b>Total net</b></td><td align="right">${ccy} ${totals.net.toFixed(2)}</td></tr>
          </table>
          <p style="margin-top:18px">
            <a href="${link}" style="display:inline-block;padding:12px 22px;background:#b9302a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
              Review &amp; approve →
            </a>
          </p>
          <p style="color:#666;font-size:12px;margin-top:24px">
            Submitted by ${esc(u.email)} via TeebeePay. This link is valid for 7 days. No sign-in required.
          </p>
        `;
        try {
          await resend.emails.send({ from: FROM, to: approverEmail, subject, html });
          approverEmailedTo = approverEmail;
        } catch (e) { console.warn("[payroll-periods] approver email failed:", e); }
      }
    } catch (e) { console.warn("[payroll-periods] approver email step failed:", e); }

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "payroll.submit",
      resource_type: "pay_period", resource_id: periodId.toString(),
      company_id: id,
      details: { entries: inserted, period_start: b.period_start, period_end: b.period_end,
                 approver_emailed: approverEmailedTo },
    });

    return NextResponse.json({ ok: true, id: periodId.toString(), entries: inserted, approverEmailedTo });
  } catch (e: any) {
    console.error("[teebeepay/payroll-periods POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
