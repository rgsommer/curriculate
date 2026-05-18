// Post-approval summary email. Called by both approve routes (in-app and
// magic-link) after the period flips to "approved". Sends a single summary
// email to every active Principal / system_owner user with:
//   - per-line totals (gross / tax / Nasfund / other / net)
//   - bottom-line bank-funding amount (employee nets + service fees)
//   - service-fee split rows
//   - bank-upload instructions (editable on the Pricing defaults page)
//   - PDF attachment: per-employee table (employee/hours/rate/gross/tax/deductions/net)
import { Resend } from "resend";
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeebeePay <noreply@curriculate.net>";
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function fmt(n: number, ccy = "PGK"): string {
  return `${ccy} ${Number(n || 0).toLocaleString("en-PG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function sendApprovalSummary(dbi: any, opts: {
  company: any;
  period: any;
  entries: any[];
  serviceFees: any[];   // [{ name, amount, account_no?, account_name? }]
  approver: string;     // email or "magic-link"
}): Promise<{ sent: number; recipients: string[] }> {
  const { company, period, entries, serviceFees, approver } = opts;
  if (!(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY)) {
    return { sent: 0, recipients: [] };
  }

  // Recipients — every Principal + system_owner across the whole bureau,
  // active only. Bookkeepers don't get it by default (they're typically the
  // ones doing the upload, not the ones approving the bank transfer).
  const users: any[] = await dbi.collection("users").find({
    role: { $in: ["principal", "system_owner"] },
    $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
  }).toArray();
  const recipients = Array.from(new Set(users.map((u: any) => String(u.email || "").toLowerCase()).filter(Boolean)));
  if (!recipients.length) return { sent: 0, recipients: [] };

  // Totals
  const ccy = company?.currency || "PGK";
  const totals = entries.reduce((a: any, e: any) => ({
    gross: a.gross + (Number(e.gross) || 0),
    tax: a.tax + (Number(e.tax) || 0),
    nasfund: a.nasfund + (Number(e.nasfund) || 0),
    other: a.other + (Number(e.other_deductions) || 0),
    net: a.net + (Number(e.net) || 0),
  }), { gross: 0, tax: 0, nasfund: 0, other: 0, net: 0 });
  const feeTotal = serviceFees.reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
  const bankFunding = totals.net + feeTotal;

  // Upload instructions
  const sys: any = await dbi.collection("system_settings").findOne({ _id: "pricing_defaults" as any });
  const instructions = (sys?.bank_upload_instructions || "").trim();
  const instructionsHtml = instructions
    ? instructions.replace(/\n/g, "<br>")
    : `Open BSP Batch Manager → upload the CSV from the period page →
       confirm the totals match the table above → approve in BSP →
       transfer ${esc(fmt(bankFunding, ccy))} into the payroll account before the pay date.`;

  const feeRows = serviceFees.map((f: any) => `
    <tr>
      <td style="padding:6px 10px;color:#6b7280">Service fee — ${esc(f.name)}</td>
      <td align="right" style="padding:6px 10px;font-variant-numeric:tabular-nums">${esc(fmt(f.amount, ccy))}</td>
    </tr>`).join("");

  const subject = `Payroll APPROVED — ${company?.name || ""} · ${ccy} ${Number(bankFunding).toFixed(2)} bank funding required`;

  const html = `
    <div style="font:14px/1.5 -apple-system,Segoe UI,Arial;color:#0f172a;max-width:600px">
      <h2 style="margin:0 0 6px">${esc(company?.name || "")} — payroll approved</h2>
      <p style="margin:0 0 18px;color:#475569">
        Period <strong>${esc(period.period_start)} → ${esc(period.period_end)}</strong> ·
        pay date <strong>${esc(period.pay_date)}</strong> · approved by <strong>${esc(approver)}</strong>.
      </p>

      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:18px">
        <tr style="background:#fafbfc"><td style="padding:6px 10px"><strong>Entries</strong></td><td align="right" style="padding:6px 10px">${entries.length}</td></tr>
        <tr><td style="padding:6px 10px">Total gross</td><td align="right" style="padding:6px 10px;font-variant-numeric:tabular-nums">${esc(fmt(totals.gross, ccy))}</td></tr>
        <tr><td style="padding:6px 10px;color:#6b7280">Salary or Wages Tax</td><td align="right" style="padding:6px 10px;font-variant-numeric:tabular-nums">- ${esc(fmt(totals.tax, ccy))}</td></tr>
        <tr><td style="padding:6px 10px;color:#6b7280">Nasfund employee</td><td align="right" style="padding:6px 10px;font-variant-numeric:tabular-nums">- ${esc(fmt(totals.nasfund, ccy))}</td></tr>
        <tr><td style="padding:6px 10px;color:#6b7280">Other deductions</td><td align="right" style="padding:6px 10px;font-variant-numeric:tabular-nums">- ${esc(fmt(totals.other, ccy))}</td></tr>
        <tr style="background:#f3f4f6"><td style="padding:8px 10px"><strong>Total net to employees</strong></td><td align="right" style="padding:8px 10px;font-variant-numeric:tabular-nums"><strong>${esc(fmt(totals.net, ccy))}</strong></td></tr>
        ${feeRows}
        <tr style="background:#fef3c7"><td style="padding:10px;font-size:15px"><strong>BANK FUNDING REQUIRED</strong></td><td align="right" style="padding:10px;font-size:15px;font-variant-numeric:tabular-nums"><strong>${esc(fmt(bankFunding, ccy))}</strong></td></tr>
      </table>

      <h3 style="margin:18px 0 8px;font-size:14px">Upload instructions</h3>
      <div style="background:#fafbfc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;color:#334155;font-size:13px">
        ${instructionsHtml}
      </div>

      <p style="color:#6b7280;font-size:12px;margin-top:24px">
        Sent automatically by TeebeePay when payroll was approved. Edit these instructions on the Service fees page → Bureau-wide pricing defaults → Bank upload instructions.
      </p>
    </div>
  `;

  // Build the per-employee detail PDF for attachment
  let pdfBase64: string | null = null;
  let pdfFilename = "payroll-detail.pdf";
  try {
    const empIds = entries.map((e: any) => e.employee_id);
    const empDocs: any[] = await dbi.collection("employees").find({ _id: { $in: empIds } }).toArray();
    const empMap: Record<string, any> = Object.fromEntries(empDocs.map((e: any) => [e._id.toString(), e]));
    const rows = entries.map((e: any) => {
      const emp = empMap[e.employee_id.toString()] || {};
      const rate = emp.pay_type === "salary"
        ? `${ccy} ${Number(emp.annual_salary || 0).toFixed(0)} / yr`
        : `${ccy} ${Number(emp.hourly_rate || 0).toFixed(2)} / hr`;
      return {
        name: `${emp.last_name || ""}, ${emp.first_name || ""}`.replace(/^,\s*/, "").trim() || "—",
        pay_type: emp.pay_type === "salary" ? "Salary" : "Hourly",
        hours: Number(e.hours || 0),
        rate,
        gross: Number(e.gross || 0),
        tax: Number(e.tax || 0),
        nasfund: Number(e.nasfund || 0),
        other: Number(e.other_deductions || 0),
        net: Number(e.net || 0),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const buf = await renderApprovalPdf({
      company, period, rows, totals, feeTotal, bankFunding, serviceFees, approver,
    });
    pdfBase64 = buf.toString("base64");
    const abbr = (company?.abbreviation || company?.name || "company").replace(/\W+/g, "_");
    pdfFilename = `${abbr}-payroll-detail-${(period.period_end || "").replace(/-/g, "")}.pdf`;
  } catch (e) {
    console.warn("[post_approval] PDF build failed:", e);
  }

  try {
    const sendOpts: any = { from: FROM, to: recipients, subject, html };
    if (pdfBase64) {
      sendOpts.attachments = [{ filename: pdfFilename, content: pdfBase64 }];
    }
    await resend.emails.send(sendOpts);
    return { sent: recipients.length, recipients };
  } catch (e) {
    console.warn("[post_approval] send failed:", e);
    return { sent: 0, recipients };
  }
}

/* ──────────────── Per-employee detail PDF ──────────────── */

async function renderApprovalPdf(opts: {
  company: any; period: any; rows: any[];
  totals: { gross: number; tax: number; nasfund: number; other: number; net: number };
  feeTotal: number; bankFunding: number;
  serviceFees: any[]; approver: string;
}): Promise<Buffer> {
  const { company, period, rows, totals, feeTotal, bankFunding, serviceFees, approver } = opts;
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(0.058, 0.172, 0.321);
  const INK = rgb(0.039, 0.101, 0.180);
  const MUTED = rgb(0.392, 0.455, 0.545);
  const GOLD = rgb(0.788, 0.635, 0.152);
  const ccy = company?.currency || "PGK";

  let page = pdf.addPage([842, 595]); // A4 landscape — wider for table
  let W = page.getWidth(), H = page.getHeight();
  let y = H - 50;

  function fmtN(n: number): string {
    return Number(n || 0).toLocaleString("en-PG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function newPage() {
    page = pdf.addPage([842, 595]);
    W = page.getWidth(); H = page.getHeight();
    y = H - 50;
    drawHeaderBand();
    drawTableHeader();
  }
  function drawHeaderBand() {
    page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: NAVY });
    page.drawText(`${company?.name || "Company"} — payroll detail`,
      { x: 40, y: H - 36, size: 18, font: bold, color: GOLD });
    page.drawText(`Period ${period.period_start} → ${period.period_end} · pay date ${period.pay_date} · approved by ${approver}`,
      { x: 40, y: H - 58, size: 10, font: reg, color: rgb(0.7, 0.78, 0.86) });
    y = H - 100;
  }
  const cols = [
    { label: "Employee", x: 40,  w: 180, align: "left" as const },
    { label: "Type",     x: 220, w: 50,  align: "left" as const },
    { label: "Hours",    x: 270, w: 50,  align: "right" as const },
    { label: "Rate",     x: 320, w: 90,  align: "right" as const },
    { label: "Gross",    x: 410, w: 70,  align: "right" as const },
    { label: "Tax",      x: 480, w: 60,  align: "right" as const },
    { label: "Nasfund",  x: 540, w: 60,  align: "right" as const },
    { label: "Other",    x: 600, w: 60,  align: "right" as const },
    { label: "Net",      x: 660, w: 142, align: "right" as const },
  ];
  function drawTableHeader() {
    page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 18, color: rgb(0.96, 0.96, 0.97) });
    for (const c of cols) {
      const tx = c.align === "right"
        ? c.x + c.w - bold.widthOfTextAtSize(c.label, 9) - 6
        : c.x + 6;
      page.drawText(c.label, { x: tx, y: y + 1, size: 9, font: bold, color: rgb(0.3, 0.35, 0.42) });
    }
    y -= 18;
  }
  function ensureSpace(need: number) {
    if (y - need < 60) newPage();
  }
  function drawRow(r: any, isTotal = false) {
    ensureSpace(16);
    const f = isTotal ? bold : reg;
    const c = isTotal ? INK : INK;
    const vals: [string, typeof cols[number]][] = [
      [r.name || "—", cols[0]],
      [r.pay_type || "", cols[1]],
      [r.hours != null ? fmtN(r.hours) : "", cols[2]],
      [r.rate || "", cols[3]],
      [fmtN(r.gross), cols[4]],
      [fmtN(r.tax), cols[5]],
      [fmtN(r.nasfund), cols[6]],
      [fmtN(r.other), cols[7]],
      [fmtN(r.net), cols[8]],
    ];
    for (const [v, c2] of vals) {
      const tx = c2.align === "right" ? c2.x + c2.w - f.widthOfTextAtSize(v, 9) - 6 : c2.x + 6;
      page.drawText(v, { x: tx, y: y, size: 9, font: f, color: c });
    }
    y -= 14;
    page.drawLine({ start: { x: 40, y }, end: { x: W - 40, y }, thickness: 0.3, color: rgb(0.9, 0.9, 0.9) });
    y -= 2;
  }

  drawHeaderBand();
  drawTableHeader();
  for (const r of rows) drawRow(r);

  // Totals row + bank-funding tile
  y -= 4;
  ensureSpace(20);
  page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 22, color: rgb(0.95, 0.95, 0.97) });
  drawRow({
    name: `TOTAL — ${rows.length} employees`, pay_type: "", hours: null, rate: "",
    gross: totals.gross, tax: totals.tax, nasfund: totals.nasfund,
    other: totals.other, net: totals.net,
  }, true);

  // Service fees + bank funding
  ensureSpace(70);
  y -= 8;
  page.drawText("Service fees appended to BSP batch", { x: 40, y, size: 11, font: bold, color: INK });
  y -= 16;
  for (const f of serviceFees) {
    page.drawText(`${f.name}${f.account_no ? ` · ${f.account_no}` : ""}`, { x: 60, y, size: 9, font: reg, color: MUTED });
    const v = `${ccy} ${fmtN(f.amount)}`;
    page.drawText(v, { x: W - 60 - reg.widthOfTextAtSize(v, 9), y, size: 9, font: reg, color: INK });
    y -= 12;
  }
  if (feeTotal > 0) {
    page.drawLine({ start: { x: 60, y: y + 6 }, end: { x: W - 60, y: y + 6 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    page.drawText("Service-fee subtotal", { x: 60, y, size: 9, font: bold, color: INK });
    const v = `${ccy} ${fmtN(feeTotal)}`;
    page.drawText(v, { x: W - 60 - bold.widthOfTextAtSize(v, 9), y, size: 9, font: bold, color: INK });
    y -= 18;
  }
  page.drawRectangle({ x: 40, y: y - 28, width: W - 80, height: 32, color: rgb(0.996, 0.953, 0.78),
    borderColor: rgb(0.85, 0.70, 0.20), borderWidth: 0.8 });
  page.drawText("BANK FUNDING REQUIRED", { x: 56, y: y - 12, size: 13, font: bold, color: NAVY });
  const bf = `${ccy} ${fmtN(bankFunding)}`;
  page.drawText(bf, { x: W - 60 - bold.widthOfTextAtSize(bf, 13), y: y - 12, size: 13, font: bold, color: NAVY });
  page.drawText("Total to transfer into the payroll account before the pay date",
    { x: 56, y: y - 24, size: 9, font: reg, color: MUTED });
  y -= 50;

  // Footer
  page.drawText(`Generated by TeebeePay · ${new Date().toISOString().slice(0, 10)}`,
    { x: 40, y: 30, size: 9, font: reg, color: MUTED });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
