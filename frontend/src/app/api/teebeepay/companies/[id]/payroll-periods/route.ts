// POST  → create a new draft pay period with entries.
// Body  : { period_start, period_end, pay_date, entries: [{ employee_id, hours, cash_advance, note }] }
// Status: 'pending_approval'  (approval later via /payroll-periods/[pid]/approve)
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId, makeApprovalToken } from "../../../_auth";
import { calculate } from "../../../_payroll";

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

    return NextResponse.json({ ok: true, id: periodId.toString(), entries: inserted, approverEmailedTo });
  } catch (e: any) {
    console.error("[teebeepay/payroll-periods POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
