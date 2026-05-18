// frontend/src/app/api/teebeepay/_paystub_pdf.ts
//
// Generate a single-page A4 pay stub PDF for one employee, using pdf-lib
// (no native fonts on disk — serverless-safe). Used by the period-archive
// ZIP route to bundle one PDF per employee.
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

const NAVY     = rgb(0.058, 0.172, 0.321);
const GOLD     = rgb(0.788, 0.635, 0.152);
const INK      = rgb(0.039, 0.101, 0.180);
const SOFT     = rgb(0.278, 0.337, 0.412);
const MUTED    = rgb(0.392, 0.455, 0.545);
const WHITE    = rgb(1, 1, 1);
const HILITE   = rgb(0.949, 0.961, 0.984);   // for net-pay row bg

function r2(n: number) { return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }

export async function buildPayStubPdf(company: any, period: any, employee: any, entry: any): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const reg  = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const page = pdf.addPage(PageSizes.A4);
  const W = page.getWidth(), H = page.getHeight();
  const ccy = company.currency || "PGK";

  // ── Header band ──
  page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: NAVY });

  // Company logo if present, else just the name
  let nameX = 48;
  if (company.logo_image && company.logo_mime) {
    try {
      const ext = company.logo_mime.includes("png") ? "png" : "jpeg";
      const bytes = Buffer.from(company.logo_image, "base64");
      const img = ext === "png"
        ? await pdf.embedPng(new Uint8Array(bytes))
        : await pdf.embedJpg(new Uint8Array(bytes));
      const scale = Math.min(54 / img.height, 100 / img.width);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: 48, y: H - 30 - h, width: w, height: h });
      nameX = 48 + w + 16;
    } catch { /* ignore image errors */ }
  }
  page.drawText(company.name || "", { x: nameX, y: H - 38, size: 20, font: bold, color: WHITE });
  page.drawText("Pay stub", { x: nameX, y: H - 58, size: 11, font: reg, color: GOLD });

  // ── Period strip ──
  page.drawText(`Period ${period.period_start} to ${period.period_end}  ·  Pay date ${period.pay_date}`,
    { x: 48, y: H - 118, size: 11, font: reg, color: SOFT });

  // ── Employee block ──
  const empName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
  page.drawText(empName, { x: 48, y: H - 152, size: 16, font: bold, color: INK });
  const subtitle: string[] = [];
  if (employee.job_function) subtitle.push(employee.job_function);
  if (employee.department) subtitle.push(employee.department);
  if (employee.email) subtitle.push(employee.email);
  if (subtitle.length) {
    page.drawText(subtitle.join(" · "), { x: 48, y: H - 168, size: 10, font: reg, color: MUTED });
  }
  if (employee.bank_account_name || employee.bank_account_no) {
    page.drawText(`Bank: ${employee.bank_account_name || ""}${employee.bank_account_no ? "  ·  " + employee.bank_account_no : ""}`,
      { x: 48, y: H - 184, size: 10, font: reg, color: MUTED });
  }

  // ── Pay rows table ──
  const breakdown = entry.calc_breakdown || {};
  const lines: Array<[string, string, "in" | "out" | "total"]> = [
    ["Hours worked", String(Number(entry.hours || 0).toFixed(2)), "in"],
    ["Gross",        `${ccy} ${r2(Number(entry.gross || 0))}`,   "in"],
  ];
  for (const a of (breakdown.allowance_lines || [])) {
    lines.push([`  + ${a.name}`, `${ccy} ${r2(a.amount)}`, "in"]);
  }
  lines.push(["Salary / wages tax", `- ${ccy} ${r2(Number(entry.tax || 0))}`, "out"]);
  lines.push(["Nasfund (6%)",       `- ${ccy} ${r2(Number(entry.nasfund || 0))}`, "out"]);
  for (const d of (breakdown.post_tax_deductions || [])) {
    lines.push([`  - ${d.name}`, `- ${ccy} ${r2(d.amount)}`, "out"]);
  }
  if (Number(entry.cash_advance || 0) > 0) {
    lines.push(["Cash advance", `- ${ccy} ${r2(Number(entry.cash_advance))}`, "out"]);
  }
  lines.push(["Net pay", `${ccy} ${r2(Number(entry.net || 0))}`, "total"]);

  const tableX = 48, tableW = W - 96;
  let yRow = H - 220;
  for (const [label, value, kind] of lines) {
    const isTotal = kind === "total";
    if (isTotal) {
      page.drawRectangle({ x: tableX, y: yRow - 4, width: tableW, height: 22, color: HILITE });
    }
    const font = isTotal ? bold : reg;
    page.drawText(label, { x: tableX + 12, y: yRow + 4, size: 11, font, color: INK });
    const w = font.widthOfTextAtSize(value, 11);
    page.drawText(value, { x: tableX + tableW - 12 - w, y: yRow + 4, size: 11, font, color: INK });
    page.drawLine({
      start: { x: tableX, y: yRow - 4 }, end: { x: tableX + tableW, y: yRow - 4 },
      thickness: 0.5, color: rgb(0.92, 0.92, 0.92),
    });
    yRow -= 22;
  }

  // ── Manager note ──
  if (entry.note) {
    yRow -= 16;
    page.drawText("Note from manager:", { x: 48, y: yRow, size: 11, font: bold, color: INK });
    yRow -= 14;
    drawWrapped(page, ital, 11, SOFT, String(entry.note), 48, yRow, tableW, 14);
    yRow -= 40;
  }

  // ── Company payslip message ──
  if (company.payslip_message) {
    yRow -= 12;
    drawWrapped(page, reg, 10, SOFT, String(company.payslip_message), 48, yRow, tableW, 13);
  }

  // ── Footer ──
  centerText(page, reg, 9, MUTED,
    `Generated by TeebeePay on ${new Date().toISOString().slice(0, 10)} for ${empName}`,
    30, W);

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function drawWrapped(page: any, font: any, size: number, color: any,
                     text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = String(text).split(/\s+/);
  let line = "", cur = y;
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      page.drawText(line, { x, y: cur, size, font, color });
      cur -= lineHeight; line = w;
    } else { line = trial; }
  }
  if (line) page.drawText(line, { x, y: cur, size, font, color });
}
function centerText(page: any, font: any, size: number, color: any, text: string, y: number, pageW: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (pageW - w) / 2, y, size, font, color });
}
